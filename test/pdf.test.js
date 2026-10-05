import { describe, expect, it } from "vitest"
import { renderInvoicePdf } from "../server/pdf/invoice-pdf.js"
import { defaultCustomers, defaultSettings } from "../server/seed.js"
import { computeTotals } from "../shared/money.js"

/** Reads the text of an uncompressed pdfkit PDF (its strings are hex coded). */
function pdfText(buffer) {
  const source = buffer.toString("latin1")
  const out = []
  for (const match of source.matchAll(/\[((?:\s*<[0-9a-fA-F]*>|\s*-?\d+(?:\.\d+)?)*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
    const parts = match[1] !== undefined ? [...match[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((part) => part[1]) : [match[2]]
    out.push(parts.map((hex) => Buffer.from(hex, "hex").toString("latin1")).join(""))
  }
  return out.join("\n")
}

const seller = defaultSettings().company
const buyer = defaultCustomers()[0]
const pagesOf = (pdf) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length

function invoice(overrides = {}) {
  const lines = overrides.lines ?? [
    { description: "Beratung Softwarearchitektur", quantity: 12, unit: "HUR", unitPrice: 145, vatRate: 19 },
    { description: "Fachbuch", quantity: 2, unit: "C62", unitPrice: 29.5, vatRate: 7 },
  ]
  return {
    number: "RE-2026-0001", issueDate: "2026-10-05", dueDate: "2026-10-19", language: "de", seller, buyer, lines,
    totals: computeTotals(lines), buyerReference: "PO-2026-4711", paymentTerms: "Zahlbar innerhalb von 14 Tagen.", ...overrides,
  }
}

describe("the invoice PDF", () => {
  it("is a real one-page PDF with a title", async () => {
    const pdf = await renderInvoicePdf(invoice())
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.subarray(-6).toString()).toContain("%%EOF")
    expect(pagesOf(pdf)).toBe(1)
    const source = pdf.toString("latin1")
    expect(source).toMatch(/\/Title \d+ 0 R/)
    expect(source).toContain("/DisplayDocTitle")
    expect(source).toContain("/Lang")
  })

  it("shows the number, the parties, the amounts and the bank details", async () => {
    const text = pdfText(await renderInvoicePdf(invoice(), { compress: false }))
    for (const expected of [
      "RE-2026-0001", "Beispiel Software GmbH", "Muster Maschinenbau GmbH", "Beratung Softwarearchitektur",
      "1.740,00", "1.799,00", "330,60", "4,13", "2.133,73", "05.10.2026", "19.10.2026", "PO-2026-4711", "DE89 3704 0044 0532 0130 00", "COBADEFFXXX", "DE123456789",
    ]) {
      expect(text, expected).toContain(expected)
    }
  })

  it("speaks English when asked", async () => {
    const text = pdfText(await renderInvoicePdf(invoice({ language: "en" }), { compress: false }))
    expect(text).toContain("INVOICE")
    expect(text).toContain("Invoice number")
    expect(text).toContain("5 Oct 2026")
    expect(text).not.toContain("Rechnungsnummer")
  })

  it("lists the VAT per rate and the reason for a tax-exempt line", async () => {
    const lines = [
      { description: "Standard", quantity: 1, unit: "C62", unitPrice: 100, vatRate: 19 },
      { description: "Export", quantity: 1, unit: "C62", unitPrice: 200, vatRate: 0 },
    ]
    const text = pdfText(await renderInvoicePdf(invoice({ lines, exemptionReason: "Steuerfreie Ausfuhr" }), { compress: false }))
    expect(text).toContain("zzgl. 19 % USt")
    expect(text).toContain("USt-frei auf")
    expect(text).toContain("Steuerfreie Ausfuhr")
  })

  it("flows onto more pages with a header on each, page numbers and a footer", async () => {
    const lines = Array.from({ length: 60 }, (_, index) => ({ description: `Position ${index + 1}`, quantity: 1, unit: "C62", unitPrice: 10, vatRate: 19 }))
    const pdf = await renderInvoicePdf(invoice({ lines }), { compress: false })
    const pages = pagesOf(pdf)
    expect(pages).toBeGreaterThanOrEqual(2)
    const text = pdfText(pdf)
    expect(text).toContain(`Seite 1 von ${pages}`)
    expect(text).toContain(`Seite ${pages} von ${pages}`)
    // The table header is repeated on every page that has line items (the last page may hold only the totals).
    expect(text.match(/Beschreibung/g).length).toBeGreaterThanOrEqual(2)
    expect(text.match(/Beschreibung/g).length).toBeLessThanOrEqual(pages)
    expect(text.match(/Beispiel Software GmbH/g).length).toBeGreaterThanOrEqual(pages)
    expect(text).toContain("Position 60")
  })

  it("copes with very long descriptions and umlauts", async () => {
    const lines = [{ description: "Größenänderung für Übungsräume – äußerst lang ".repeat(30), quantity: 1.5, unit: "HUR", unitPrice: 99.99, vatRate: 19 }]
    const pdf = await renderInvoicePdf(invoice({ lines, note: "Zusätzliche Bemerkung mit Sonderzeichen: ä ö ü ß €" }))
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pagesOf(pdf)).toBeGreaterThanOrEqual(1)
  })

  it("is small", async () => {
    expect((await renderInvoicePdf(invoice())).length).toBeLessThan(20_000)
  })
})
