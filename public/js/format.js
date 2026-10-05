// Numbers, money and dates in the language of the UI.

/** @param {"de"|"en"} lang */
export function formatters(lang) {
  const locale = lang === "de" ? "de-DE" : "en-GB"
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" })
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 })
  const day = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: lang === "de" ? "2-digit" : "short", year: "numeric" })
  const moment = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })

  return {
    money: (value) => money.format(Number(value) || 0),
    number: (value) => number.format(Number(value) || 0),
    /** "2026-10-05" or "2026-10-05T00:00:00" as a calendar date. */
    date: (iso) => (iso ? day.format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)) : ""),
    dateTime: (iso) => (iso ? moment.format(new Date(iso)) : ""),
    /** "3 minutes ago" */
    ago(iso) {
      const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
      const units = [["day", 86400], ["hour", 3600], ["minute", 60]]
      for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), /** @type {Intl.RelativeTimeFormatUnit} */ (unit))
      }
      return relative.format(Math.min(seconds, 0), "second")
    },
    bytes(size) {
      if (size < 1024) return `${size} B`
      if (size < 1024 * 1024) return `${number.format(Math.round(size / 102.4) / 10)} KB`
      return `${number.format(Math.round(size / 104857.6) / 10)} MB`
    },
  }
}
