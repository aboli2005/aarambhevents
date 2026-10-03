import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { API, CONTACT, DAYS, EVENT, TYPES, dayLabel, dayShort, makeTicketPdf, people, summary } from './ticket'
import { downloadXlsx } from './xlsx'
import './styles.css'

const go = (p) => { location.hash = '/' + p }
const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN')
const okPhone = (s) => s.replace(/\D/g, '').length >= 10
const plural = (b) => `${people(b)} ${people(b) > 1 ? 'people' : 'person'}`
const todayISO = () => new Date().toLocaleDateString('en-CA')

let token = sessionStorage.getItem('aar_token')
const setToken = (t) => { token = t; t ? sessionStorage.setItem('aar_token', t) : sessionStorage.removeItem('aar_token') }
async function api(path, { method = 'GET', body, auth } = {}) {
  const res = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let data = null; try { data = await res.json() } catch {}
  if (!res.ok) { const e = new Error(data?.error || 'Request failed'); e.status = res.status; throw e }
  return data
}
const loadRazorpay = () => window.Razorpay ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = rej; document.body.append(s) })

function useRoute() {
  const get = () => location.hash.replace(/^#\/?/, '').split('/')
  const [r, setR] = useState(get)
  useEffect(() => { const f = () => { setR(get()); window.scrollTo(0, 0) }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return r
}

const Field = ({ label, ...p }) => <label className="fld"><span>{label}</span><input {...p} /></label>
const Qty = ({ v, set }) => <div className="qty"><button type="button" aria-label="Less" onClick={() => set(Math.max(0, v - 1))}>−</button><b>{v}</b><button type="button" aria-label="More" onClick={() => set(Math.min(10, v + 1))}>+</button></div>

function Nav({ role, onLogout }) {
  return <header className="nav"><div className="page nav-in">
    <a className="brand" href="#/"><img src="/logo.png" alt="" /><span>Aarambh</span></a><div className="sp" />
    {role ? <>
      {role === 'admin' && <a className="lnk" href="#/admin">Dashboard</a>}
      <a className="lnk" href="#/scan">Scanner</a>
      <button className="btn ghost sm" onClick={onLogout}>Logout</button></>
      : <><a className="lnk" href="#/login">Staff</a><a className="btn sm" href="#/book">Book</a></>}
  </div></header>
}

function Home() {
  return <main className="page">
    <section className="hero"><img className="logo" src="/logo.png" alt={EVENT.name} />
      <h1>{EVENT.name}</h1>
      <p className="mu">17 · 18 · 19 October 2026<br />{EVENT.venue}</p>
      <a className="btn lg" href="#/book">Book tickets</a>
      <p style={{ margin: '14px 0 0' }}><a className="lnk" href="#/find">Already booked? Find my ticket</a></p></section>
    <section><h2>Tickets</h2><div className="grid2">
      {Object.entries(TYPES).map(([k, t]) => <div className="card" key={k}>
        <div className="between"><h3>{t.title}</h3><b className="price">{rupee(t.price)}</b></div>
        <p className="mu sm" style={{ margin: '8px 0 10px' }}>{t.desc}</p><span className="chip">Early bird · per day</span></div>)}</div></section>
    <section><h2>Good to know</h2><div className="card mu">Only entry is included with the ticket. No age limit. Anyone found drunk or misbehaving can be removed by the management. If the organiser cancels, or pre-event government regulations require it, the amount is refunded.</div></section>
    <section><h2>Organiser</h2><div className="card"><b>Aarambh Events</b><p className="mu sm" style={{ margin: '4px 0 0' }}>No : {CONTACT.phone} | Email : {CONTACT.email} | Insta : {CONTACT.insta}</p></div></section>
  </main>
}

function Booking() {
  const [day, setDay] = useState(DAYS[0].id), [q, setQ] = useState({ f: 0, c: 0 }), [step, setStep] = useState(0)
  const [u, setU] = useState({ name: '', email: '', phone: '' }), [att, setAtt] = useState([]), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const total = q.f * TYPES.f.price + q.c * TYPES.c.price, n = q.f + q.c * 2
  const okU = u.name.trim() && /\S+@\S+\.\S+/.test(u.email) && okPhone(u.phone)
  const okA = att.every((a) => a.name.trim() && okPhone(a.phone))
  const next = () => { if (step === 1) setAtt(Array.from({ length: n }, (_, i) => att[i] || { name: i ? '' : u.name, phone: i ? '' : u.phone })); setStep(step + 1) }
  const setA = (i, k, v) => setAtt(att.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const titles = ['Select tickets', 'Your details', 'Guest details']

  const pay = async () => {
    setBusy(true); setErr('')
    let o
    try { o = await api('/order', { method: 'POST', body: { day, q, user: u, attendees: att } }) }
    catch (e) { setBusy(false); setErr(e.status ? e.message : 'Could not reach the server. Check your connection and try again.'); return }
    if (o.demo) { // server is in demo mode (no Razorpay keys): simulate the payment
      if (!confirm(`Demo mode (no Razorpay key on the server).\nSimulate payment of ${rupee(total)}?`)) { setBusy(false); return }
      try { go('done/' + (await api('/demo-pay', { method: 'POST', body: { orderId: o.orderId } })).code) } catch (e) { setBusy(false); setErr(e.message) }
      return
    }
    try {
      await loadRazorpay()
      new window.Razorpay({
        key: o.keyId, amount: o.amount, currency: 'INR', order_id: o.orderId, name: EVENT.name, description: `${dayLabel(day)} · ${summary({ q })}`,
        prefill: { name: u.name, email: u.email, contact: u.phone }, theme: { color: '#6b0b12' }, modal: { ondismiss: () => setBusy(false) },
        handler: async (r) => {
          try { go('done/' + (await api('/verify', { method: 'POST', body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } })).code) }
          catch { go('pending/' + o.orderId) } // the payment went through; the server confirms it by itself (webhook), so just wait for it
        },
      }).open()
    } catch { setBusy(false); setErr('Could not open Razorpay. Check your connection and try again.') }
  }

  return <main className="page narrow main-pad">
    <a className="back" href={step ? undefined : '#/'} onClick={step ? (e) => { e.preventDefault(); setStep(step - 1) } : undefined}>← Back</a>
    <div className="mu sm">Step {step + 1} of 3</div><div className="progress"><i style={{ width: `${(step + 1) * 33.4}%` }} /></div>
    <h2>{titles[step]}</h2>

    {step === 0 && <>
      <div className="pills">{DAYS.map((d) => <button key={d.id} className={'pill' + (day === d.id ? ' on' : '')} onClick={() => setDay(d.id)}>{d.label}</button>)}</div>
      {Object.entries(TYPES).map(([k, t]) => <div className="opt" key={k}>
        <div className="between"><h3>{t.title}</h3><b className="price">{rupee(t.price)}</b></div>
        <p className="mu sm">{t.desc}</p>
        <div className="opt-b"><span className="chip">Early bird · valid {dayShort(day)} only</span><Qty v={q[k]} set={(v) => setQ({ ...q, [k]: v })} /></div></div>)}</>}

    {step === 1 && <>
      <p className="mu sm">Your ticket will be e-mailed to you.</p>
      <Field label="Full name" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} autoComplete="name" />
      <Field label="Email" type="email" inputMode="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} autoComplete="email" />
      <Field label="Phone number" type="tel" inputMode="tel" value={u.phone} onChange={(e) => setU({ ...u, phone: e.target.value })} autoComplete="tel" /></>}

    {step === 2 && <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="kv"><span>Date</span><span>{dayLabel(day)}</span></div>
        <div className="kv"><span>Tickets</span><span>{summary({ q })}</span></div>
        <div className="kv"><span>E-mail</span><span>{u.email}</span></div></div>
      <p className="mu sm">Only you receive the ticket, but we need every guest's details.</p>
      {att.map((a, i) => <div className="card" key={i} style={{ marginBottom: 12 }}><b>Guest {i + 1}</b><div style={{ height: 8 }} />
        <Field label="Name" value={a.name} onChange={(e) => setA(i, 'name', e.target.value)} />
        <Field label="Phone" type="tel" inputMode="tel" value={a.phone} onChange={(e) => setA(i, 'phone', e.target.value)} /></div>)}
      {err && <p className="err">{err}</p>}</>}

    <div className="cta"><div className="cta-in">
      <div className="tot"><span>Total</span><b>{rupee(total)}</b></div>
      {step < 2 ? <button className="btn" disabled={!total || (step === 1 && !okU)} onClick={next}>Continue</button>
        : <button className="btn" disabled={!okA || busy} onClick={pay}>{busy ? 'Please wait…' : `Pay ${rupee(total)}`}</button>}
    </div></div>
  </main>
}

function Pending({ orderId }) {
  const [tries, setTries] = useState(0)
  useEffect(() => {
    const t = setInterval(async () => {
      setTries((x) => x + 1)
      try { const r = await api('/order/' + orderId); if (r.status === 'paid' && r.code) go('done/' + r.code) } catch {}
    }, 3000)
    return () => clearInterval(t)
  }, [orderId])
  return <main className="page narrow"><section className="c">
    <h2>Confirming your payment…</h2>
    <p className="mu">Please keep this page open. This usually takes a few seconds.</p>
    {tries > 20 && <div className="card" style={{ marginTop: 16, textAlign: 'left' }}><p className="sm">This is taking longer than usual. If money was deducted, your ticket will still be issued and e-mailed to you automatically. If you do not receive it, contact the organiser and quote this reference:</p><b>{orderId}</b></div>}
  </section></main>
}

function Done({ code }) {
  const [b, setB] = useState(null), [missing, setMissing] = useState(false), tries = useRef(0)
  useEffect(() => {
    let t, dead = false
    const load = async () => {
      try { const r = await api('/ticket/' + code); if (dead) return; setB(r); if (r.mailEnabled && !r.emailed && ++tries.current < 8) t = setTimeout(load, 5000) }
      catch (e) { if (!dead && e.status === 404) setMissing(true); else if (!dead && tries.current++ < 8) t = setTimeout(load, 4000) }
    }
    load(); return () => { dead = true; clearTimeout(t) }
  }, [code])
  if (missing) return <main className="page narrow"><section className="c"><h2>Ticket not found</h2><a className="btn" href="#/">Home</a></section></main>
  if (!b) return <main className="page narrow"><section className="c"><p className="mu">Loading your ticket…</p></section></main>
  return <main className="page narrow"><section className="c">
    <h1>You're in!</h1><p className="mu" style={{ margin: '8px 0 20px' }}>Your booking is confirmed.</p>
    <div className="card" style={{ textAlign: 'left' }}>
      <div className="kv"><span>Ticket</span><b>{b.code}</b></div>
      <div className="kv"><span>Name</span><span>{b.name}</span></div>
      <div className="kv"><span>Date</span><span>{dayLabel(b.day)}</span></div>
      <div className="kv"><span>Entry</span><span>{plural(b)} ({summary(b)})</span></div>
      <div className="kv"><span>Paid</span><span>{rupee(b.total)}</span></div></div>
    <p className="sm" style={{ margin: '14px 0', color: b.emailed ? 'var(--ok)' : 'var(--mu)' }}>
      {b.emailed ? `Ticket e-mailed to ${b.emailMasked}` : b.mailEnabled ? 'We are e-mailing your ticket. You can also download it below.' : <>Download your ticket now and keep it safe. If you lose it, use <a href="#/find">Find my ticket</a> with your phone number and e-mail.</>}</p>
    <div style={{ display: 'grid', gap: 10 }}><button className="btn lg block" onClick={() => makeTicketPdf(b)}>Download ticket (PDF)</button><a className="btn ghost block" href="#/">Back to home</a></div>
  </section></main>
}

function FindTicket() {
  const [f, setF] = useState({ phone: '', email: '' }), [res, setRes] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setRes(null)
    try { setRes((await api('/find', { method: 'POST', body: f })).tickets) }
    catch (x) { setErr(x.status ? x.message : 'Could not reach the server. Please try again in a minute.') }
    setBusy(false)
  }
  return <main className="page narrow"><section><h2>Find my ticket</h2>
    <p className="mu sm">Enter the phone number and e-mail you used while booking.</p>
    <form className="card" onSubmit={submit}>
      <Field label="Phone number" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />
      <Field label="Email" type="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
      {err && <p className="err">{err}</p>}
      <button className="btn block" type="submit" disabled={busy || !okPhone(f.phone) || !f.email.trim()}>{busy ? 'Searching…' : 'Find ticket'}</button></form>
    {res && res.map((b) => <div className="card" key={b.code} style={{ marginTop: 12 }}>
      <div className="between"><b>{b.code}</b><span className="mu sm">{dayLabel(b.day)}</span></div>
      <p className="mu sm" style={{ margin: '6px 0 12px' }}>{b.name} · {plural(b)} ({summary(b)})</p>
      <button className="btn block" onClick={() => makeTicketPdf(b)}>Download ticket (PDF)</button></div>)}
  </section></main>
}

function Login({ onLogin }) {
  const [id, setId] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await api('/login', { method: 'POST', body: { username: id, password: pw } }); onLogin(r.role, r.token) }
    catch (x) { setErr(x.status ? x.message : 'Could not reach the server. Try again.') }
    setBusy(false)
  }
  return <main className="page narrow"><section><h2>Staff login</h2>
    <form className="card" onSubmit={submit}>
      <Field label="Username" value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="none" autoComplete="username" />
      <Field label="Password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
      {err && <p className="err">{err}</p>}
      <button className="btn block" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Login'}</button></form></section></main>
}

function Admin({ onAuthFail }) {
  const [day, setDay] = useState('all'), [q, setQ] = useState(''), [open, setOpen] = useState(null), [list, setList] = useState(null), [err, setErr] = useState(''), [note, setNote] = useState(''), [mailOn, setMailOn] = useState(false)
  const load = async () => {
    try { const r = await api('/bookings', { auth: true }); setList(r.bookings); setMailOn(!!r.mailEnabled); setErr('') }
    catch (e) { if (e.status === 401) onAuthFail(); else setErr('Could not refresh. Retrying…') }
  }
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t) }, [])
  const resend = async (code) => { try { await api('/resend', { method: 'POST', body: { code }, auth: true }); setNote('E-mail sent again for ' + code); load() } catch (e) { setNote(e.message) } }
  if (!list) return <main className="page"><section><h2>Dashboard</h2><div className="empty">{err || 'Loading bookings…'}</div></section></main>
  const base = list.filter((b) => day === 'all' || b.day === day)
  const s = q.trim().toLowerCase()
  const rows = [...base].reverse().filter((b) => !s || [b.name, b.phone, b.email, b.code].join(' ').toLowerCase().includes(s))
  const stats = [['Bookings', base.length], ['Guests', base.reduce((a, b) => a + people(b), 0)], ['Revenue', rupee(base.reduce((a, b) => a + b.total, 0))], ['Checked in', base.filter((b) => b.usedAt).length]]

  const exportXlsx = () => {
    const when = (t) => t ? new Date(t).toLocaleString('en-IN') : ''
    const bookings = [['Ticket code', 'Booked on', 'Name', 'Phone', 'Email', 'Event date', 'Female tickets', 'Couple tickets', 'Total guests', 'Amount (Rs)', 'Payment ID', 'Status', 'Checked in at'],
      ...rows.map((b) => [b.code, when(b.at), b.name, b.phone, b.email, dayLabel(b.day), b.q.f, b.q.c, people(b), b.total, b.paymentId, b.usedAt ? 'Checked in' : 'Not checked in', when(b.usedAt)])]
    const guests = [['Ticket code', 'Guest no.', 'Guest name', 'Guest phone', 'Event date', 'Booked by', 'Booker phone'],
      ...rows.flatMap((b) => b.attendees.map((a, i) => [b.code, i + 1, a.name, a.phone, dayLabel(b.day), b.name, b.phone]))]
    downloadXlsx(`Aarambh-Customers-${todayISO()}.xlsx`, [{ name: 'Bookings', rows: bookings }, { name: 'Guests', rows: guests }])
  }

  return <main className="page"><section>
    <div className="between"><h2 style={{ margin: 0 }}>Dashboard</h2><button className="btn sm" onClick={exportXlsx} disabled={!rows.length}>Export Excel</button></div>
    {err && <p className="err" style={{ marginTop: 8 }}>{err}</p>}{note && <p className="mu sm" style={{ marginTop: 8 }}>{note}</p>}
    <div className="stats">{stats.map(([k, v]) => <div className="stat" key={k}><span>{k}</span><b>{v}</b></div>)}</div>
    <div className="tabs">{[{ id: 'all', label: 'All days' }, ...DAYS].map((d) => <button key={d.id} className={'pill' + (day === d.id ? ' on' : '')} onClick={() => setDay(d.id)}>{d.label}</button>)}</div>
    <input placeholder="Search name, phone, email or ticket code" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 14 }} />
    {!rows.length && <div className="empty">{list.length ? 'No bookings match.' : 'No bookings yet.'}</div>}
    {rows.map((b) => <div className="item" key={b.id}>
      <button className="item-h" onClick={() => setOpen(open === b.id ? null : b.id)}>
        <div><b>{b.name}</b><div className="mu sm">{summary(b)} · {dayShort(b.day)}</div><div className="mu sm">{b.phone}</div></div>
        <div className="r"><b>{rupee(b.total)}</b><span className={'tag ' + (b.usedAt ? 'used' : 'ok')}>{b.usedAt ? 'Checked in' : 'Valid'}</span></div></button>
      {open === b.id && <div className="item-b">
        <div className="kv"><span>Ticket</span><span>{b.code}</span></div>
        <div className="kv"><span>Email</span><span>{b.email}</span></div>
        <div className="kv"><span>Payment</span><span>{b.paymentId}</span></div>
        <div className="kv"><span>Booked</span><span>{new Date(b.at).toLocaleString('en-IN')}</span></div>
        <div className="kv"><span>Guests</span><span>{b.attendees.map((a, i) => <div key={i}>{a.name} · {a.phone}</div>)}</span></div>
        {mailOn && <div className="kv"><span>E-mail sent</span><span>{b.emailed ? 'Yes' : 'Not yet'} <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => resend(b.code)}>Send again</button></span></div>}</div>}
    </div>)}
  </section></main>
}

function Scanner({ onCheck }) {
  const [res, setRes] = useState(null), [code, setCode] = useState('')
  const sc = useRef(null), last = useRef(0), cb = useRef(onCheck); cb.current = onCheck
  const stop = () => { sc.current?.stop().catch(() => {}); sc.current = null }
  const start = async () => {
    stop(); const s = new Html5Qrcode('reader'); sc.current = s
    try { await s.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (t) => { if (Date.now() - last.current > 2500) { last.current = Date.now(); Promise.resolve(cb.current(t)).then(setRes) } }) }
    catch { sc.current = null; setRes({ ok: false, msg: 'Camera unavailable – use manual entry.' }) }
  }
  useEffect(() => stop, [])
  return <main className="page narrow"><section><h2>Entry scanner</h2><div id="reader" />
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '14px 0' }}><button className="btn" onClick={start}>Start camera</button><button className="btn ghost" onClick={stop}>Stop</button></div>
    <div className="row"><input placeholder="AAR-XXXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" /><button className="btn" onClick={async () => { const c = code; setCode(''); setRes(await onCheck(c)) }}>Check</button></div>
    {res && <div className={`res ${res.ok ? 'ok' : 'bad'}`}>{res.msg}</div>}</section></main>
}

export default function App() {
  const [role, setRole] = useState(() => sessionStorage.getItem('aar_role'))
  const [page, arg] = useRoute()

  const login = (r, t) => { setToken(t); setRole(r); sessionStorage.setItem('aar_role', r); go(r === 'admin' ? 'admin' : 'scan') }
  const logout = () => { setToken(null); setRole(null); sessionStorage.removeItem('aar_role'); go('') }
  const check = async (raw) => {
    try { return await api('/checkin', { method: 'POST', body: { code: raw }, auth: true }) }
    catch (e) { if (e.status === 401) { logout(); return { ok: false, msg: 'Session expired. Please login again.' } } return { ok: false, msg: 'No connection – nothing was recorded. Scan again.' } }
  }
  const authed = role && token

  const view = page === 'book' ? <Booking />
    : page === 'pending' ? <Pending orderId={arg} />
    : page === 'done' ? <Done code={arg} />
    : page === 'find' ? <FindTicket />
    : page === 'admin' ? (role === 'admin' && authed ? <Admin onAuthFail={logout} /> : <Login onLogin={login} />)
    : page === 'scan' ? (authed ? <Scanner onCheck={check} /> : <Login onLogin={login} />)
    : page === 'login' ? <Login onLogin={login} />
    : <Home />
  return <><Nav role={authed ? role : null} onLogout={logout} />{view}{page !== 'book' && <footer>© 2026 Aarambh Events · {CONTACT.phone} · {CONTACT.email}<br /><a href="#/find">Find my ticket</a></footer>}</>
}
