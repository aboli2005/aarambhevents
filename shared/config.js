// Shared by the website (src/) and the server (server/). Prices are always re-calculated on the server from here.
export const EVENT = { name: 'Aarambh Dandiya Nights 2026', venue: 'Hyatt Place Aurangabad Airport' }
export const DAYS = [{ id: '2026-10-17', label: '17 Oct' }, { id: '2026-10-18', label: '18 Oct' }, { id: '2026-10-19', label: '19 Oct' }, { id: '2026-10-03', label: '03 Oct' }]
export const TYPES = {
  f: { title: 'Female Entry', desc: 'Entry for 1 female to the venue and the Dandiya celebration area.', price: 1, people: 1 },
  c: { title: 'Couple Entry', desc: 'Entry for 1 male and 1 female (couple only) to the venue and the Dandiya celebration area.', price: 1999, people: 2 },
}
export const CONTACT = { phone: '+91 7776936250', email: 'aarambheventscsn@gmail.com', insta: '@aarambhevents.csn' } // demo
export const TERMS = 'Entry only. Valid for the date above, single scan. Management may remove anyone found drunk or misbehaving. ID may be requested.'

export const dayLabel = (id) => new Date(id + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
export const dayShort = (id) => new Date(id + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
export const people = (b) => b.q.f * TYPES.f.people + b.q.c * TYPES.c.people
export const summary = (b) => [b.q.f && `${b.q.f} Female`, b.q.c && `${b.q.c} Couple`].filter(Boolean).join(' + ')
