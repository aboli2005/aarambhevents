import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { EVENT, TERMS, dayLabel, people, summary } from '../shared/config.js'

export { CONTACT, DAYS, EVENT, TERMS, TYPES, dayLabel, dayShort, people, summary } from '../shared/config.js'
export const API = '/api' // on Netlify this is forwarded to the Render server (see public/_redirects)

// logo is downscaled so the PDF (and the e-mail attachment) stays small
const img = (src, max = 500) => new Promise((r) => {
  const i = new Image()
  i.onload = () => { const k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); r(c.toDataURL('image/png')) }
  i.onerror = () => r(null); i.src = src
})

// Shrinks the font until the text fits `w` mm; truncates with "..." only as a last resort. Font must be set before calling.
const fit = (d, text, w, size, min = 7) => {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim()
  d.setFontSize(size)
  while (size > min && d.getTextWidth(t) > w) { size -= 0.5; d.setFontSize(size) }
  if (d.getTextWidth(t) > w) { while (t.length > 1 && d.getTextWidth(t + '...') > w) t = t.slice(0, -1); t = t.trim() + '...' }
  return t
}

const C = { bg: [251, 243, 225], maroon: [107, 11, 18], ink: [43, 26, 20], mu: [122, 103, 87], line: [214, 196, 160] }

export async function makeTicketPdf(b, save = true) {
  const [qr, logo] = await Promise.all([QRCode.toDataURL(b.code, { width: 400, margin: 1, color: { dark: '#6b0b12', light: '#ffffff' } }), img('/logo.png')])
  const W = 190, H = 80
  const d = new jsPDF({ orientation: 'l', unit: 'mm', format: [W, H] })

  // background + frame
  d.setFillColor(...C.bg); d.rect(0, 0, W, H, 'F')
  d.setDrawColor(...C.maroon); d.setLineWidth(0.5); d.rect(3, 3, W - 6, H - 6)

  // logo
  if (logo) d.addImage(logo, 'PNG', 9, 10, 34, 34)

  // tear-off line between details and QR
  d.setDrawColor(...C.line); d.setLineWidth(0.3); d.setLineDashPattern([1.2, 1.2], 0); d.line(132, 7, 132, H - 7); d.setLineDashPattern([], 0)

  // details column (x 50 -> 126)
  const x = 50, w = 76
  d.setFont('helvetica', 'bold'); d.setTextColor(...C.maroon)
  d.text(fit(d, EVENT.name.toUpperCase(), w, 15, 9), x, 17)
  d.setFont('helvetica', 'normal'); d.setTextColor(...C.ink)
  d.text(fit(d, dayLabel(b.day), w, 10, 7), x, 24)
  d.setTextColor(...C.mu)
  d.text(fit(d, EVENT.venue, w, 9, 6.5), x, 29.5)

  d.setFont('helvetica', 'bold'); d.setFontSize(8); d.setTextColor(...C.mu); d.text('ADMIT', x, 40)
  d.setFont('helvetica', 'bold'); d.setTextColor(...C.maroon)
  d.text(fit(d, b.name, w, 17, 9), x, 48.5)

  const n = people(b)
  d.setFont('helvetica', 'normal'); d.setTextColor(...C.ink)
  d.text(fit(d, `${n} ${n > 1 ? 'people' : 'person'}  (${summary(b)})`, w, 10.5, 7), x, 55.5)
  d.setTextColor(...C.mu)
  d.text(fit(d, `Paid Rs ${b.total}  |  ${b.phone}`, w, 9, 6.5), x, 61.5)

  // terms
  d.setDrawColor(...C.line); d.setLineWidth(0.3); d.line(9, 66, 126, 66)
  d.setFont('helvetica', 'normal'); d.setFontSize(7); d.setTextColor(...C.mu)
  d.text(d.splitTextToSize(TERMS, 117).slice(0, 3), 9, 70.3, { lineHeightFactor: 1.35 })

  // QR panel (centre x = 159.5)
  d.setFillColor(255, 255, 255); d.setDrawColor(...C.line); d.setLineWidth(0.3); d.roundedRect(137.5, 9, 44, 44, 2, 2, 'FD')
  d.addImage(qr, 'PNG', 139.5, 11, 40, 40)
  d.setFont('helvetica', 'bold'); d.setTextColor(...C.maroon)
  d.text(fit(d, b.code, 46, 11, 7), 159.5, 60, { align: 'center' })
  d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.setTextColor(...C.mu)
  d.text('Scan at venue entry', 159.5, 66, { align: 'center' })

  if (save) d.save(`Aarambh-Ticket-${b.code}.pdf`)
  return d.output('datauristring').split(',')[1]
}
