import QRCode from 'qrcode'
import { EVENT, dayLabel, people, summary } from '../shared/config.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The e-mail carries the QR itself (works at the gate straight from the inbox) plus a link to download the PDF ticket.
export async function sendTicketEmail(mailer, cfg, b) {
  const qr = await QRCode.toBuffer(b.code, { width: 320, margin: 1, color: { dark: '#6b0b12', light: '#ffffff' } })
  const n = people(b), link = `${cfg.siteUrl}/#/done/${b.code}`
  const inline = mailer.supportsCid // SMTP can show the QR inside the mail; the Brevo API sends it as an attachment instead
  const html = `<div style="background:#f7efe0;padding:24px;font-family:Arial,sans-serif;color:#2b1a14">
<div style="max-width:480px;margin:0 auto;background:#fffaf1;border:1px solid #e6d5b5;border-radius:14px;padding:24px">
<h2 style="margin:0 0 4px;color:#6b0b12;font-family:Georgia,serif">${esc(EVENT.name)}</h2>
<p style="margin:0 0 16px;color:#7a6757">${esc(dayLabel(b.day))} · ${esc(EVENT.venue)}</p>
<p style="margin:0 0 4px">Hi ${esc(b.name)}, your booking is confirmed.</p>
<p style="margin:0 0 16px"><b>${n} ${n > 1 ? 'people' : 'person'}</b> (${esc(summary(b))}) · Paid Rs ${b.total}</p>
<div style="text-align:center;margin:16px 0">${inline ? '<img src="cid:ticketqr" width="200" height="200" alt="Ticket QR" style="border:1px solid #e6d5b5;border-radius:8px">' : ''}<div style="font-weight:bold;color:#6b0b12;margin-top:8px;letter-spacing:1px;font-size:18px">${esc(b.code)}</div></div>
<p style="text-align:center;margin:20px 0"><a href="${esc(link)}" style="background:#6b0b12;color:#fff7e8;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">Download PDF ticket</a></p>
<p style="color:#7a6757;font-size:13px;margin:0">Show the QR code ${inline ? 'above' : '(attached to this e-mail, or in the PDF ticket)'} at the entry. One scan only. Valid for the date above.</p>
</div></div>`
  await mailer.send({ fromName: cfg.mailFromName, fromEmail: cfg.mailFromEmail, to: b.email, subject: `Your ticket – ${EVENT.name} (${dayLabel(b.day)})`, html,
    attachments: [{ filename: `ticket-${b.code}.png`, content: qr, ...(inline ? { cid: 'ticketqr' } : {}) }] })
}
