import crypto from 'crypto'

const sha = (x) => crypto.createHash('sha256').update(String(x)).digest()
export const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b))

// Small signed token (HMAC-SHA256), valid for 12 hours. Survives server restarts as long as AUTH_SECRET stays the same.
export function makeAuth(secret, ttlMs = 12 * 3600 * 1000) {
  const mac = (body) => crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return {
    sign(payload) { const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url'); return body + '.' + mac(body) },
    verify(token) {
      try {
        const [body, sig] = String(token || '').split('.')
        if (!body || !sig) return null
        const a = Buffer.from(sig), b = Buffer.from(mac(body))
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
        const p = JSON.parse(Buffer.from(body, 'base64url').toString())
        return p.exp > Date.now() ? p : null
      } catch { return null }
    },
  }
}
