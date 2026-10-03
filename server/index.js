import dns from 'node:dns';

dns.setServers([
  '8.8.8.8',
  '8.8.4.4'
]);

import 'dotenv/config'
import { MongoClient } from 'mongodb'
import Razorpay from 'razorpay'
import { createApp } from './app.js'
import { createCore } from './core.js'
import { sendTicketEmail } from './mail.js'
import { createMailer } from './mailers.js'
import { EVENT } from '../shared/config.js'

const need = (k) => { if (!process.env[k]) { console.error(`Missing ${k}. Add it to .env (local) or the Render Environment tab.`); process.exit(1) } return process.env[k] }
const env = process.env
if (need('AUTH_SECRET').length < 16) { console.error('AUTH_SECRET must be at least 16 characters.'); process.exit(1) }

const cfg = {
  authSecret: env.AUTH_SECRET,
  users: [{ username: need('ADMIN_USER'), password: need('ADMIN_PASS'), role: 'admin' }, { username: need('OPERATOR_USER'), password: need('OPERATOR_PASS'), role: 'operator' }],
  rzpKeyId: env.RAZORPAY_KEY_ID, rzpKeySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  demo: env.DEMO_PAYMENTS === 'true', dateCheck: env.DATE_CHECK !== 'false', tz: env.EVENT_TZ || 'Asia/Kolkata',
  siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  mailFromEmail: env.MAIL_FROM_EMAIL || env.SMTP_USER, mailFromName: env.MAIL_FROM_NAME || EVENT.name,
}

const client = new MongoClient(need('MONGODB_URI'), { maxPoolSize: 20, serverSelectionTimeoutMS: 8000 })
await client.connect()
const db = client.db(env.MONGODB_DB || 'aarambh'), bookings = db.collection('bookings')
await bookings.createIndex({ orderId: 1 }, { unique: true })
await bookings.createIndex({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } })
await bookings.createIndex({ paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } })
await bookings.createIndex({ status: 1, paidAt: -1 })
await bookings.createIndex({ email: 1, status: 1 })

const rzp = cfg.rzpKeyId && cfg.rzpKeySecret ? new Razorpay({ key_id: cfg.rzpKeyId, key_secret: cfg.rzpKeySecret }) : null
if (!rzp && !cfg.demo) console.warn('No Razorpay keys and DEMO_PAYMENTS is not true: booking is disabled.')
if (rzp && !cfg.webhookSecret) console.warn('RAZORPAY_WEBHOOK_SECRET is not set: bookings will rely on the browser confirming payment. Set up the webhook before going live.')
const mailer = await createMailer(env)
if (!mailer) console.warn('No mail settings found: tickets will not be e-mailed (customers can still download them).')
else if (!cfg.mailFromEmail) { console.error('Set MAIL_FROM_EMAIL (the address tickets are sent from).'); process.exit(1) }
else if (!cfg.siteUrl) console.warn('SITE_URL is not set: the "Download PDF ticket" link in e-mails will be broken.')

const core = createCore({ bookings, rzp, cfg, ping: () => db.command({ ping: 1 }), sendEmail: mailer ? (d) => sendTicketEmail(mailer, cfg, d) : null })
const server = createApp(core, { corsOrigin: env.CORS_ORIGIN }).listen(env.PORT || 5001, () => console.log('API on :' + (env.PORT || 5001)))
setTimeout(core.sweep, 10000); setInterval(core.sweep, 60000)

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e))
process.on('SIGTERM', () => { server.close(() => client.close().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 10000).unref() })
