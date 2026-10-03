// Two ways to send mail, chosen by environment variables:
//  1. Brevo HTTPS API  (BREVO_API_KEY)  -> works on FREE Render (Render blocks SMTP ports on free instances)
//  2. SMTP / Gmail     (SMTP_HOST ...)  -> works locally and on a PAID Render instance
// Both expose the same send({ fromName, fromEmail, to, subject, html, attachments:[{filename, content:Buffer, cid?}] }).

export function brevoMailer(apiKey, fetchFn = fetch) {
  return {
    supportsCid: false, // Brevo's API has no inline images, so the QR is sent as a normal attachment
    async send({ fromName, fromEmail, to, subject, html, attachments = [] }) {
      const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail }, to: [{ email: to }], subject, htmlContent: html,
          ...(attachments.length ? { attachment: attachments.map((a) => ({ name: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`)
    },
  }
}

export async function smtpMailer(env) {
  const { default: nodemailer } = await import('nodemailer')
  const port = +env.SMTP_PORT || 465
  const t = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465, pool: true, maxConnections: 3, connectionTimeout: 15000, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } })
  return {
    supportsCid: true,
    send: ({ fromName, fromEmail, to, subject, html, attachments = [] }) => t.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, html, attachments }),
  }
}

export async function createMailer(env) {
  if (env.BREVO_API_KEY) return brevoMailer(env.BREVO_API_KEY)
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return smtpMailer(env)
  return null
}
