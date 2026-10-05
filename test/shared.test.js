import { describe, expect, it } from "vitest"
import { addDays, daysBetween, fromGermanDate, isIsoDate, toApiDateTime } from "../shared/dates.js"
import { isValidIban, normalizeIban } from "../shared/iban.js"
import { computeTotals, round, round2, vatCategory } from "../shared/money.js"

describe("rounding", () => {
  it("rounds half away from zero without floating point surprises", () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(1.255)).toBe(1.26)
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round(1.00005, 4)).toBe(1.0001)
  })

  it("copes with tiny, huge and invalid numbers", () => {
    expect(round2(1e-9)).toBe(0)
    expect(round2(1e21)).toBe(1e21)
    expect(round2(Number.NaN)).toBe(0)
    expect(round2("abc")).toBe(0)
    expect(round2("12.345")).toBe(12.35)
  })
})

describe("computeTotals", () => {
  it("computes net, VAT and gross for one line", () => {
    const totals = computeTotals([{ quantity: 12, unitPrice: 145, vatRate: 19 }])
    expect(totals).toMatchObject({ net: 1740, vat: 330.6, gross: 2070.6 })
    expect(totals.breakdown).toEqual([{ category: "S", rate: 19, taxable: 1740, tax: 330.6 }])
  })

  it("avoids the classic float traps in a line total", () => {
    expect(computeTotals([{ quantity: 3, unitPrice: 0.1, vatRate: 19 }]).lines[0].net).toBe(0.3)
    expect(computeTotals([{ quantity: 1.1, unitPrice: 1.1, vatRate: 19 }]).lines[0].net).toBe(1.21)
  })

  it("rounds VAT once per VAT group, as EN 16931 requires, not once per line", () => {
    // Three lines of 1.49 at 7 %: per line the VAT would be 0.10 each (0.30 in total),
    // per group it is 4.47 x 7 % = 0.3129, which is 0.31.
    const lines = Array.from({ length: 3 }, () => ({ quantity: 1, unitPrice: 1.49, vatRate: 7 }))
    expect(computeTotals(lines)).toMatchObject({ net: 4.47, vat: 0.31, gross: 4.78 })
  })

  it("groups by rate, highest first, and marks 0 % as exempt", () => {
    const totals = computeTotals([
      { quantity: 1, unitPrice: 100, vatRate: 7 },
      { quantity: 1, unitPrice: 200, vatRate: 0 },
      { quantity: 1, unitPrice: 300, vatRate: 19 },
      { quantity: 1, unitPrice: 50, vatRate: 19 },
    ])
    expect(totals.breakdown.map((group) => [group.category, group.rate, group.taxable, group.tax])).toEqual([
      ["S", 19, 350, 66.5],
      ["S", 7, 100, 7],
      ["E", 0, 200, 0],
    ])
    expect(totals).toMatchObject({ net: 650, vat: 73.5, gross: 723.5 })
  })

  it("handles an empty invoice", () => {
    expect(computeTotals([])).toEqual({ lines: [], net: 0, vat: 0, gross: 0, breakdown: [] })
  })

  it("always keeps gross equal to net plus VAT and net equal to the sum of the lines", () => {
    let seed = 7
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let run = 0; run < 200; run += 1) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 8) }, () => ({
        quantity: Math.round(random() * 5000) / 100 + 0.01,
        unitPrice: Math.round(random() * 250000) / 100,
        vatRate: [19, 7, 0][Math.floor(random() * 3)],
      }))
      const totals = computeTotals(lines)
      expect(totals.gross).toBe(round2(totals.net + totals.vat))
      expect(totals.net).toBe(round2(totals.lines.reduce((sum, line) => sum + line.net, 0)))
      expect(totals.vat).toBe(round2(totals.breakdown.reduce((sum, group) => sum + group.tax, 0)))
    }
  })

  it("maps rates to category codes", () => {
    expect(vatCategory(19)).toBe("S")
    expect(vatCategory(7)).toBe("S")
    expect(vatCategory(0)).toBe("E")
  })
})

describe("dates", () => {
  it("recognises real calendar dates only", () => {
    expect(isIsoDate("2026-10-05")).toBe(true)
    expect(isIsoDate("2028-02-29")).toBe(true)
    expect(isIsoDate("2026-02-29")).toBe(false)
    expect(isIsoDate("2026-13-01")).toBe(false)
    expect(isIsoDate("05.10.2026")).toBe(false)
    expect(isIsoDate("2026-10-05T00:00:00")).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })

  it("adds days across month, year and leap day boundaries", () => {
    expect(addDays("2026-10-05", 14)).toBe("2026-10-19")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("counts days between two dates", () => {
    expect(daysBetween("2026-10-05", "2026-10-19")).toBe(14)
    expect(daysBetween("2026-10-19", "2026-10-05")).toBe(-14)
    expect(daysBetween("2026-10-05", "2026-10-05")).toBe(0)
  })

  it("formats dates the way the API wants them: midnight, no time zone offset", () => {
    expect(toApiDateTime("2026-10-05")).toBe("2026-10-05T00:00:00")
  })

  it("converts the analyzer's German dates", () => {
    expect(fromGermanDate("24.08.2026")).toBe("2026-08-24")
    expect(fromGermanDate("2026-08-24")).toBe("2026-08-24")
    expect(fromGermanDate(undefined)).toBe("")
  })
})

describe("IBAN", () => {
  it("accepts valid IBANs in any spelling", () => {
    expect(isValidIban("DE89370400440532013000")).toBe(true)
    expect(isValidIban("de89 3704 0044 0532 0130 00")).toBe(true)
    expect(isValidIban("GB82WEST12345698765432")).toBe(true)
  })

  it("rejects a wrong check digit, a wrong shape and non-text", () => {
    expect(isValidIban("DE89370400440532013001")).toBe(false)
    expect(isValidIban("DE89")).toBe(false)
    expect(isValidIban("1234567890")).toBe(false)
    expect(isValidIban(undefined)).toBe(false)
  })

  it("normalizes", () => {
    expect(normalizeIban(" de89 3704 0044 0532 0130 00 ")).toBe("DE89370400440532013000")
  })
})
