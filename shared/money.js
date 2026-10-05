// Money and VAT arithmetic shared by the server and the browser.
//
// The live totals in the invoice form and the amounts sent to RechnungsAPI come from this one
// file, so they can never disagree. EN 16931 checks the arithmetic (rules BR-CO-10 to BR-CO-17),
// which is why every sum is done in integer cents and every VAT amount is rounded once per
// VAT group, exactly as the standard describes.

/** Rounds half away from zero to `digits` decimals, without binary floating point surprises. */
export function round(value, digits = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (Math.abs(n) >= 2 ** 52) return n // no fractional digits are left to round
  const sign = n < 0 ? -1 : 1
  const text = String(Math.abs(n))
  if (text.includes("e")) return (sign * Math.round(Math.abs(n) * 10 ** digits)) / 10 ** digits
  return sign * Number(`${Math.round(Number(`${text}e${digits}`))}e-${digits}`)
}

export const round2 = (value) => round(value, 2)

/** VAT rates the demo offers. 0 % is a tax-exempt line and needs an exemption reason. */
export const VAT_RATES = [19, 7, 0]

/** UNTDID 5305 category code for a rate: "S" is standard-rated, "E" is exempt. */
export const vatCategory = (rate) => (Number(rate) === 0 ? "E" : "S")

const cents = (amount) => Math.round(round2(amount) * 100)

/**
 * Totals of an invoice, as EN 16931 defines them.
 *
 * @param {Array<{ quantity: number, unitPrice: number, vatRate: number }>} lines
 * @returns {{
 *   lines: Array<{ net: number }>,
 *   net: number,
 *   vat: number,
 *   gross: number,
 *   breakdown: Array<{ category: string, rate: number, taxable: number, tax: number }>
 * }}
 */
export function computeTotals(lines) {
  let netCents = 0
  /** @type {Map<number, number>} rate -> taxable cents */
  const groups = new Map()
  const computed = lines.map((line) => {
    const net = round2(Number(line.quantity) * Number(line.unitPrice))
    const rate = Number(line.vatRate)
    netCents += cents(net)
    groups.set(rate, (groups.get(rate) ?? 0) + cents(net))
    return { net }
  })

  let vatCents = 0
  const breakdown = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, taxableCents]) => {
      const taxCents = Math.round((taxableCents * rate) / 100)
      vatCents += taxCents
      return { category: vatCategory(rate), rate, taxable: taxableCents / 100, tax: taxCents / 100 }
    })

  return {
    lines: computed,
    net: netCents / 100,
    vat: vatCents / 100,
    gross: (netCents + vatCents) / 100,
    breakdown,
  }
}
