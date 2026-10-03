import express from 'express'
import cors from 'cors'

// Thin express wiring around server/core.js
export function createApp(core, { corsOrigin } = {}) {
  const app = express(), H = core.handlers
  app.disable('x-powered-by'); app.set('trust proxy', 1)
  if (corsOrigin) app.use(cors({ origin: corsOrigin.split(',').map((s) => s.trim()) }))

  const route = (fn, roles) => async (req, res) => {
    try {
      let user
      if (roles) { user = core.authorize(req.headers.authorization, roles); if (!user) return res.status(401).json({ error: 'Please login again' }) }
      const r = await fn({ body: req.body, raw: req.body, params: req.params, headers: req.headers, user })
      res.status(r.status || 200).json(r.json)
    } catch (e) { console.error(req.method, req.path, e); res.status(500).json({ error: 'Server error, please try again' }) }
  }

  app.get('/', (_, res) => res.type('text').send('Aarambh API is running'))
  app.get('/health', route(H.health))
  app.post('/api/webhook', express.raw({ type: '*/*', limit: '1mb' }), route(H.webhook)) // must stay BEFORE express.json (needs the raw body)
  app.use(express.json({ limit: '100kb' }))
  app.post('/api/order', route(H.order))
  app.post('/api/verify', route(H.verify))
  app.post('/api/demo-pay', route(H.demoPay))
  app.get('/api/order/:orderId', route(H.orderStatus))
  app.get('/api/ticket/:code', route(H.ticket))
  app.post('/api/find', route(H.find))
  app.post('/api/login', route(H.login))
  app.get('/api/bookings', route(H.bookings, ['admin']))
  app.post('/api/checkin', route(H.checkin, ['admin', 'operator']))
  app.post('/api/resend', route(H.resend, ['admin']))
  app.use((err, req, res, next) => res.status(err.status || 400).json({ error: 'Bad request' }))
  return app
}
