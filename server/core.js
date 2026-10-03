import crypto from 'crypto'
import { DAYS, TYPES, dayLabel, people, summary } from '../shared/config.js'
import { makeAuth, safeEq } from './auth.js'

// All business logic lives here (no express, no direct mongo import) so it can be tested on its own.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const genCode = () => 'AAR-' + [...crypto.randomBytes(10)].map((x) => CODE_CHARS[x % 32]).join('')
const unwrap = (r) => (r && Object.hasOwn(r, 'value') && Object.hasOwn(r, 'ok') ? r.value : r) // mongodb v5 vs v6 return shapes
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const phoneOk = (s) => s.replace(/\D/g, '').length >= 10
const mask = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2')
const J = (status, json) => ({ status, json })
const ms = (d) => (d ? new Date(d).getTime() : null)
export const todayISO = (tz) => new Date().toLocaleDateString('en-CA', { timeZone: tz })

function parseBooking(body) {
  const day = DAYS.find((d) => d.id === body?.day)?.id
  if (!day) return { error: 'Invalid date' }
  const int = (v) => (Number.isInteger(v) && v >= 0 && v <= 10 ? v : -1)
  const q = { f: int(body?.q?.f), c: int(body?.q?.c) }
  if (q.f < 0 || q.c < 0 || q.f + q.c === 0) return { error: 'Choose at least one ticket' }
  const u = body.user || {}, name = str(u.name, 80), email = str(u.email, 120).toLowerCase(), phone = str(u.phone, 20)
  if (!name || !/\S+@\S+\.\S+/.test(email) || !phoneOk(phone)) return { error: 'Please check your name, e-mail and phone' }
  const attendees = (Array.isArray(body.attendees) ? body.attendees.slice(0, 60) : []).map((a) => ({ name: str(a?.name, 80), phone: str(a?.phone, 20) }))
  if (attendees.length !== people({ q }) || attendees.some((a) => !a.name || !phoneOk(a.phone))) return { error: 'Please fill in every guest' }
  return { day, q, name, email, phone, attendees, total: q.f * TYPES.f.price + q.c * TYPES.c.price } // price always from server config
}

export function createCore({ bookings, rzp, sendEmail, cfg, ping = async () => {} }) {
  const auth = makeAuth(cfg.authSecret), attempts = new Map()

  const publicTicket = (d) => ({ code: d.code, name: d.name, phone: d.phone, day: d.day, q: d.q, total: d.total, emailed: !!d.emailedAt, emailMasked: mask(d.email), mailEnabled: !!sendEmail })
  const findFails = new Map()

  async function sendEmailFor(doc) {
    if (!sendEmail) return
    const now = Date.now()
    const d = unwrap(await bookings.findOneAndUpdate(
      { _id: doc._id, emailedAt: null, emailTries: { $lt: 5 }, $or: [{ emailLock: null }, { emailLock: { $lt: new Date(now - 60000) } }] },
      { $inc: { emailTries: 1 }, $set: { emailLock: new Date() } }, { returnDocument: 'after' }))
    if (!d) return
    try { await sendEmail(d); await bookings.updateOne({ _id: d._id }, { $set: { emailedAt: new Date() } }) }
    catch (e) { console.error('e-mail failed for', d.code, e.message) } // the sweeper retries later
  }

  // Marks a pending order as paid exactly once. Safe to call from verify, webhook and sweeper at the same time.
  async function finalize(orderId, paymentId) {
    for (let i = 0; i < 3; i++) {
      try {
        const d = unwrap(await bookings.findOneAndUpdate({ orderId, status: 'pending' }, { $set: { status: 'paid', paymentId, code: genCode(), paidAt: new Date() } }, { returnDocument: 'after' }))
        if (d) { sendEmailFor(d).catch(() => {}); return d }
        return await bookings.findOne({ orderId, status: 'paid' })
      } catch (e) { if (e?.code !== 11000 || i === 2) throw e } // duplicate code (practically impossible): try a new one
    }
  }

  async function sweep() { // runs every minute: retries failed e-mails and confirms payments whose webhook/verify never arrived
    if (sweep.busy) return; sweep.busy = true
    try {
      const now = Date.now()
      if (sendEmail) for (const d of await bookings.find({ status: 'paid', emailedAt: null, emailTries: { $lt: 5 }, paidAt: { $lt: new Date(now - 30000) } }).limit(10).toArray()) await sendEmailFor(d)
      if (rzp) for (const d of await bookings.find({ status: 'pending', createdAt: { $lt: new Date(now - 180000) }, checks: { $lt: 5 }, $or: [{ lastCheckAt: null }, { lastCheckAt: { $lt: new Date(now - 120000) } }] }).limit(20).toArray()) {
        await bookings.updateOne({ _id: d._id }, { $inc: { checks: 1 }, $set: { lastCheckAt: new Date() } })
        if (String(d.orderId).startsWith('demo_')) continue
        try { const r = await rzp.orders.fetchPayments(d.orderId); const p = (r.items || []).find((x) => x.status === 'captured' && x.amount === d.total * 100); if (p) await finalize(d.orderId, p.id) }
        catch (e) { console.error('reconcile failed', d.orderId, e.message) }
      }
    } catch (e) { console.error('sweep failed', e.message) } finally { sweep.busy = false }
  }

  function authorize(header, roles) {
    const p = auth.verify(String(header || '').replace(/^Bearer /, ''))
    return p && roles.includes(p.role) ? p : null
  }

  const handlers = {
    async health() { try { await ping(); return J(200, { ok: true }) } catch { return J(503, { ok: false }) } },

    async order({ body }) {
      const p = parseBooking(body || {})
      if (p.error) return J(400, { error: p.error })
      let orderId, demo = false
      if (rzp) orderId = (await rzp.orders.create({ amount: p.total * 100, currency: 'INR', receipt: 'aar_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), notes: { name: p.name, day: p.day } })).id
      else if (cfg.demo) { orderId = 'demo_' + crypto.randomBytes(8).toString('hex'); demo = true }
      else return J(503, { error: 'Payments are not configured yet' })
      await bookings.insertOne({ ...p, orderId, status: 'pending', createdAt: new Date(), checks: 0, lastCheckAt: null, usedAt: null, emailedAt: null, emailTries: 0, emailLock: null })
      return J(200, { orderId, amount: p.total * 100, keyId: cfg.rzpKeyId || null, demo })
    },

    async verify({ body }) { // called by the browser right after payment
      const { orderId, paymentId, signature } = body || {}
      if (!rzp || !orderId || !paymentId || !signature) return J(400, { error: 'Payment could not be verified' })
      const exp = crypto.createHmac('sha256', cfg.rzpKeySecret).update(`${orderId}|${paymentId}`).digest('hex')
      if (!safeEq(exp, signature)) return J(400, { error: 'Payment could not be verified' })
      const d = await finalize(orderId, paymentId)
      return d ? J(200, publicTicket(d)) : J(404, { error: 'Order not found' })
    },

    async demoPay({ body }) { // only when DEMO_PAYMENTS=true and no Razorpay keys are set
      const orderId = String(body?.orderId || '')
      if (rzp || !cfg.demo || !orderId.startsWith('demo_')) return J(403, { error: 'Not allowed' })
      const d = await finalize(orderId, 'pay_' + orderId)
      return d ? J(200, publicTicket(d)) : J(404, { error: 'Order not found' })
    },

    async webhook({ raw, headers }) { // called by Razorpay itself, so a booking is never lost if the customer closes the page
      if (!cfg.webhookSecret) return J(503, { error: 'Webhook not configured' })
      const sig = headers['x-razorpay-signature']
      const exp = crypto.createHmac('sha256', cfg.webhookSecret).update(raw || '').digest('hex')
      if (!sig || !safeEq(exp, sig)) return J(400, { error: 'Bad signature' })
      let ev; try { ev = JSON.parse(Buffer.from(raw).toString()) } catch { return J(400, { error: 'Bad body' }) }
      const pay = ev?.payload?.payment?.entity
      if ((ev.event === 'payment.captured' || ev.event === 'order.paid') && pay?.status === 'captured' && pay.order_id) {
        const d = await bookings.findOne({ orderId: pay.order_id })
        if (d && d.status === 'pending') {
          if (pay.amount === d.total * 100) await finalize(pay.order_id, pay.id)
          else console.error('webhook amount mismatch for', pay.order_id)
        }
      }
      return J(200, { ok: true })
    },

    async orderStatus({ params }) {
      const d = await bookings.findOne({ orderId: String(params.orderId) })
      return J(200, d ? { status: d.status, code: d.status === 'paid' ? d.code : undefined } : { status: 'unknown' })
    },

    async ticket({ params }) {
      const d = await bookings.findOne({ code: String(params.code).toUpperCase(), status: 'paid' })
      return d ? J(200, publicTicket(d)) : J(404, { error: 'Ticket not found' })
    },

    // "Find my ticket": needs BOTH the phone and the e-mail used at booking, so a guessed phone number alone gives nothing.
    async find({ body }) {
      const email = str(body?.email, 120).toLowerCase(), digits = String(body?.phone || '').replace(/\D/g, '').slice(-10)
      if (!/\S+@\S+\.\S+/.test(email) || digits.length < 10) return J(400, { error: 'Enter the phone number and e-mail you used while booking.' })
      const f = findFails.get(email) || { n: 0, t: Date.now() }
      if (Date.now() - f.t > 15 * 60000) { f.n = 0; f.t = Date.now() }
      if (f.n >= 10) return J(429, { error: 'Too many tries. Please wait a few minutes and try again.' })
      const rows = await bookings.find({ status: 'paid', email }).sort({ paidAt: -1 }).limit(50).toArray()
      const mine = rows.filter((d) => String(d.phone).replace(/\D/g, '').slice(-10) === digits)
      if (mine.length) return J(200, { tickets: mine.map(publicTicket) })
      if (findFails.size > 5000) findFails.clear()
      f.n++; findFails.set(email, f) // only wrong guesses count, so real customers are never blocked by traffic from others
      return J(404, { error: 'No ticket found. Check the phone number and e-mail you used while booking.' })
    },

    async login({ body }) {
      const u = str(body?.username, 60).toLowerCase(), pw = String(body?.password || '').slice(0, 200)
      const a = attempts.get(u) || { n: 0, t: Date.now() }
      if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now() }
      if (a.n >= 10) return J(429, { error: 'Too many attempts. Try again in a few minutes.' })
      const user = cfg.users.find((x) => x.username.toLowerCase() === u && safeEq(x.password, pw))
      if (!user) { a.n++; attempts.set(u, a); return J(401, { error: 'Wrong username or password' }) }
      attempts.delete(u)
      return J(200, { token: auth.sign({ role: user.role, u }), role: user.role })
    },

    async bookings() {
      const rows = await bookings.find({ status: 'paid' }).sort({ paidAt: -1 }).limit(5000).toArray()
      return J(200, { mailEnabled: !!sendEmail, bookings: rows.map((d) => ({ id: String(d._id), code: d.code, name: d.name, email: d.email, phone: d.phone, day: d.day, q: d.q, total: d.total, attendees: d.attendees, paymentId: d.paymentId, at: ms(d.paidAt), usedAt: ms(d.usedAt), emailed: !!d.emailedAt })) })
    },

    async checkin({ body, user }) {
      const code = str(body?.code, 40).toUpperCase()
      if (!code) return J(200, { ok: false, msg: 'INVALID ticket' })
      const filter = { code, status: 'paid', usedAt: null }
      if (cfg.dateCheck) filter.day = todayISO(cfg.tz)
      // one atomic update: if two gates scan the same ticket at the same moment, only one gets a match
      const d = unwrap(await bookings.findOneAndUpdate(filter, { $set: { usedAt: new Date(), usedBy: user.role } }, { returnDocument: 'after' }))
      if (d) return J(200, { ok: true, msg: `VALID – ${d.name} · ${people(d)} ${people(d) > 1 ? 'people' : 'person'} (${summary(d)})` })
      const b = await bookings.findOne({ code, status: 'paid' })
      if (!b) return J(200, { ok: false, msg: 'INVALID ticket' })
      if (b.usedAt) return J(200, { ok: false, msg: `ALREADY USED at ${new Date(b.usedAt).toLocaleString('en-IN', { timeZone: cfg.tz })} (${b.name})` })
      return J(200, { ok: false, msg: `WRONG DATE – valid for ${dayLabel(b.day)} only` })
    },

    async resend({ body }) {
      const code = str(body?.code, 40).toUpperCase()
      if (!sendEmail) return J(400, { error: 'E-mail is not configured on the server' })
      await bookings.updateOne({ code, status: 'paid' }, { $set: { emailedAt: null, emailTries: 0, emailLock: null } })
      const d = await bookings.findOne({ code, status: 'paid' })
      if (!d) return J(404, { error: 'Ticket not found' })
      await sendEmailFor(d)
      return J(200, { ok: true })
    },
  }

  return { handlers, sweep, authorize, finalize }
}
