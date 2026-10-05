// Calendar dates as plain "YYYY-MM-DD" strings. All arithmetic is done in UTC, so a date never
// shifts with the time zone of the machine (the API wants dates, not moments in time).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date such as "2026-02-28", false for "2026-02-30". */
export function isIsoDate(value) {
  if (typeof value !== "string") return false
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Today as "YYYY-MM-DD" in the local calendar (what a person at the desk calls "today"). */
export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** "2026-10-05" plus 14 days is "2026-10-19". */
export function addDays(iso, days) {
  const match = ISO_DATE.exec(iso)
  if (!match) return iso
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return date.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` ("2026-10-05" to "2026-10-19" is 14). */
export function daysBetween(from, to) {
  const parse = (iso) => {
    const match = ISO_DATE.exec(iso)
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN
  }
  return Math.round((parse(to) - parse(from)) / 86_400_000)
}

/** The format the API expects for invoice dates: midnight, without a time zone offset. */
export const toApiDateTime = (iso) => `${iso}T00:00:00`

/** "DD.MM.YYYY" (what the PDF analyzer returns) to "YYYY-MM-DD"; other input is returned as is. */
export function fromGermanDate(text) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(text ?? ""))
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(text ?? "")
}
