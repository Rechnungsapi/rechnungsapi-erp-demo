import PDFDocument from "pdfkit"
import { COUNTRIES, UNITS } from "../../shared/constants.js"
import { LABELS } from "./labels.js"

// The visual layer of a ZUGFeRD invoice.
//
// ZUGFeRD is a hybrid format: a normal PDF that people read, with the structured XML embedded in
// it for machines. RechnungsAPI creates the XML and embeds it, but it needs the PDF to embed it
// into, and that is this file. Swap it for your own invoice template or for a PDF your ERP
// already produces; the API only needs the bytes.

const PAGE = { width: 595.28, height: 841.89, left: 56, right: 56, top: 52, footer: 96 }
const WIDTH = PAGE.width - PAGE.left - PAGE.right
const BODY_END = PAGE.height - PAGE.footer

const COLOR = { brand: "#2563eb", ink: "#0f172a", muted: "#64748b", line: "#e2e8f0", soft: "#f1f5f9" }

/**
 * @param {{
 *   number: string,
 *   issueDate: string,
 *   dueDate: string,
 *   deliveryDate?: string,
 *   language: "de"|"en",
 *   seller: import("../../shared/types.js").Company,
 *   buyer: import("../../shared/types.js").Customer,
 *   lines: import("../../shared/types.js").Line[],
 *   totals: ReturnType<typeof import("../../shared/money.js").computeTotals>,
 *   buyerReference?: string,
 *   orderReference?: string,
 *   paymentTerms?: string,
 *   note?: string,
 *   exemptionReason?: string,
 * }} invoice
 * @param {{ compress?: boolean }} [options]  Turn compression off to read the PDF text in tests.
 * @returns {Promise<Buffer>}
 */
export function renderInvoicePdf(invoice, { compress = true } = {}) {
  return new Promise((resolve, reject) => {
    const t = LABELS[invoice.language] ?? LABELS.de
    const money = new Intl.NumberFormat(t.locale, { style: "currency", currency: "EUR" })
    const amount = (value) => money.format(value)
    const quantity = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 4 })
    const day = new Intl.DateTimeFormat(t.locale, { timeZone: "UTC", ...(invoice.language === "de" ? { day: "2-digit", month: "2-digit", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" }) })
    const date = (iso) => (iso ? day.format(new Date(`${iso}T00:00:00Z`)) : "")
    const unitName = (code) => UNITS.find((unit) => unit.code === code)?.[invoice.language] ?? code
    const countryName = (code) => COUNTRIES.find((country) => country.code === code)?.[invoice.language] ?? code

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: PAGE.top, left: PAGE.left, right: PAGE.right, bottom: 0 },
      bufferPages: true,
      compress,
      lang: t.locale,
      displayTitle: true,
      info: {
        Title: `${t.title} ${invoice.number}`,
        Author: invoice.seller.name,
        Subject: `${t.title} ${invoice.number}`,
        Creator: "RechnungsAPI demo ERP",
      },
    })
    const chunks = []
    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    const text = (value, x, y, options = {}) => doc.text(String(value ?? ""), x, y, { lineBreak: false, ...options })

    // --- Header -----------------------------------------------------------------------------------
    const initials = invoice.seller.name
      .split(/\s+/)
      .filter((word) => /^\p{L}/u.test(word))
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("")
    doc.circle(PAGE.left + 17, PAGE.top + 17, 17).fill(COLOR.brand)
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11)
    text(initials, PAGE.left, PAGE.top + 12, { width: 34, align: "center" })
    doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(13)
    text(invoice.seller.name, PAGE.left + 46, PAGE.top + 3, { width: 250 })
    doc.fillColor(COLOR.muted).font("Helvetica").fontSize(8.5)
    text(`${invoice.seller.zip} ${invoice.seller.city}`, PAGE.left + 46, PAGE.top + 21, { width: 250 })

    doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(26)
    text(t.title.toUpperCase(), PAGE.left, PAGE.top + 2, { width: WIDTH, align: "right" })
    doc.rect(PAGE.width - PAGE.right - 46, PAGE.top + 36, 46, 3).fill(COLOR.brand)

    // --- Address window and invoice details ---------------------------------------------------------
    const addressTop = 150
    doc.fillColor(COLOR.muted).font("Helvetica").fontSize(7)
    text(`${invoice.seller.name} · ${invoice.seller.street} · ${invoice.seller.zip} ${invoice.seller.city}`, PAGE.left, addressTop, { width: 250 })
    doc.moveTo(PAGE.left, addressTop + 11).lineTo(PAGE.left + 250, addressTop + 11).lineWidth(0.5).stroke(COLOR.line)

    doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(10.5)
    text(invoice.buyer.name, PAGE.left, addressTop + 20, { width: 250 })
    doc.font("Helvetica").fontSize(10)
    let buyerY = addressTop + 36
    for (const line of [invoice.buyer.street, `${invoice.buyer.zip} ${invoice.buyer.city}`, invoice.buyer.country && invoice.buyer.country !== "DE" ? countryName(invoice.buyer.country) : ""]) {
      if (!line) continue
      text(line, PAGE.left, buyerY, { width: 250 })
      buyerY += 14
    }
    if (invoice.buyer.vatId) {
      doc.fillColor(COLOR.muted).fontSize(8.5)
      text(`${t.vatId}: ${invoice.buyer.vatId}`, PAGE.left, buyerY + 4, { width: 250 })
    }

    const details = /** @type {Array<[string, string]>} */ (
      [
        [t.number, invoice.number],
        [t.date, date(invoice.issueDate)],
        invoice.deliveryDate ? [t.delivery, date(invoice.deliveryDate)] : null,
        [t.due, date(invoice.dueDate)],
        invoice.buyerReference ? [t.reference, invoice.buyerReference] : null,
        invoice.orderReference ? [t.order, invoice.orderReference] : null,
      ].filter(Boolean)
    )
    const detailsX = 340
    let detailsY = addressTop
    for (const [label, value] of details) {
      doc.fillColor(COLOR.muted).font("Helvetica").fontSize(8)
      text(label, detailsX, detailsY, { width: 90 })
      doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(9.5)
      text(value, detailsX + 92, detailsY - 1, { width: PAGE.width - PAGE.right - detailsX - 92, align: "right" })
      detailsY += 19
    }

    // --- Title and introduction ---------------------------------------------------------------------
    let y = Math.max(buyerY + 28, detailsY + 14, 296)
    doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(15)
    text(`${t.title} ${invoice.number}`, PAGE.left, y, { width: WIDTH })
    doc.fillColor(COLOR.muted).font("Helvetica").fontSize(9.5)
    text(t.intro, PAGE.left, y + 24, { width: WIDTH })
    y += 52

    // --- Line items -----------------------------------------------------------------------------------
    const column = { pos: 30, quantity: 46, unit: 54, price: 70, vat: 34, total: 76 }
    column.description = WIDTH - Object.values(column).reduce((sum, width) => sum + width, 0)
    const x = {}
    let cursor = PAGE.left
    for (const key of ["pos", "description", "quantity", "unit", "price", "vat", "total"]) {
      x[key] = cursor
      cursor += column[key]
    }
    const cell = (value, key, rowY, align = "left", inset = 4) =>
      text(value, x[key] + inset, rowY, { width: column[key] - inset * 2, align })

    const tableHeader = (rowY) => {
      doc.rect(PAGE.left, rowY, WIDTH, 22).fill(COLOR.soft)
      doc.fillColor(COLOR.muted).font("Helvetica-Bold").fontSize(8)
      cell(t.pos, "pos", rowY + 7)
      cell(t.description, "description", rowY + 7)
      cell(t.quantity, "quantity", rowY + 7, "right")
      cell(t.unit, "unit", rowY + 7, "left", 8)
      cell(t.price, "price", rowY + 7, "right")
      cell(t.vat, "vat", rowY + 7, "right")
      cell(t.total, "total", rowY + 7, "right")
      return rowY + 22
    }
    y = tableHeader(y)

    invoice.lines.forEach((line, index) => {
      doc.font("Helvetica").fontSize(9.5)
      const height = Math.max(doc.heightOfString(line.description, { width: column.description - 8 }), 12) + 14
      if (y + height > BODY_END) {
        doc.addPage()
        y = tableHeader(PAGE.top)
        doc.font("Helvetica").fontSize(9.5)
      }
      doc.fillColor(COLOR.muted)
      cell(String(index + 1), "pos", y + 7)
      doc.fillColor(COLOR.ink)
      doc.text(line.description, x.description + 4, y + 7, { width: column.description - 8 })
      cell(quantity.format(line.quantity), "quantity", y + 7, "right")
      cell(unitName(line.unit), "unit", y + 7, "left", 8)
      cell(amount(line.unitPrice), "price", y + 7, "right")
      cell(`${line.vatRate} %`, "vat", y + 7, "right")
      doc.font("Helvetica-Bold")
      cell(amount(invoice.totals.lines[index].net), "total", y + 7, "right")
      y += height
      doc.moveTo(PAGE.left, y).lineTo(PAGE.left + WIDTH, y).lineWidth(0.5).stroke(COLOR.line)
    })

    // --- Totals ---------------------------------------------------------------------------------------
    const totalsHeight = 34 + invoice.totals.breakdown.length * 16 + 36
    if (y + 18 + totalsHeight > BODY_END) {
      doc.addPage()
      y = PAGE.top
    }
    y += 18
    const boxX = PAGE.left + WIDTH - 250
    const row = (label, value, rowY, bold = false) => {
      doc.fillColor(bold ? COLOR.ink : COLOR.muted).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5)
      text(label, boxX, rowY, { width: 160 })
      doc.fillColor(COLOR.ink)
      text(value, boxX + 150, rowY, { width: 100, align: "right" })
    }
    row(t.net, amount(invoice.totals.net), y)
    y += 16
    for (const group of invoice.totals.breakdown) {
      row(group.rate === 0 ? t.exempt(amount(group.taxable)) : t.vatOn(group.rate, amount(group.taxable)), amount(group.tax), y)
      y += 16
    }
    doc.roundedRect(boxX - 10, y + 2, 270, 30, 4).fill(COLOR.brand)
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11)
    text(t.gross, boxX, y + 11, { width: 150 })
    text(amount(invoice.totals.gross), boxX + 120, y + 11, { width: 130, align: "right" })
    y += 52

    // --- Payment and notes ----------------------------------------------------------------------------
    const block = (title, body, color = COLOR.ink) => {
      doc.font("Helvetica").fontSize(9.5)
      const height = doc.heightOfString(body, { width: WIDTH }) + 22
      if (y + height > BODY_END) {
        doc.addPage()
        y = PAGE.top
      }
      doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(9.5)
      text(title, PAGE.left, y, { width: WIDTH })
      doc.fillColor(color).font("Helvetica").fontSize(9.5)
      doc.text(body, PAGE.left, y + 14, { width: WIDTH })
      y += height + 6
    }
    const bank = `${t.pay(date(invoice.dueDate))}\nIBAN ${formatIban(invoice.seller.iban)}${invoice.seller.bic ? `   ·   BIC ${invoice.seller.bic}` : ""}`
    block(t.payment, invoice.paymentTerms ? `${invoice.paymentTerms}\n${bank}` : bank)
    if (invoice.exemptionReason && invoice.totals.breakdown.some((group) => group.rate === 0)) {
      block(t.exemption, invoice.exemptionReason, COLOR.muted)
    }
    if (invoice.note) block(t.note, invoice.note, COLOR.muted)

    // --- Footer and page numbers on every page --------------------------------------------------------
    const range = doc.bufferedPageRange()
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index)
      const top = PAGE.height - 78
      doc.moveTo(PAGE.left, top).lineTo(PAGE.left + WIDTH, top).lineWidth(0.5).stroke(COLOR.line)
      doc.fillColor(COLOR.muted).font("Helvetica").fontSize(7.5)
      const seller = invoice.seller
      const columns = [
        [seller.name, seller.street, `${seller.zip} ${seller.city}`],
        [
          seller.phone ? `${t.tel} ${seller.phone}` : "",
          seller.email ? `${t.email} ${seller.email}` : "",
          seller.website ?? "",
        ],
        [`${t.vatId} ${seller.vatId}`, `IBAN ${formatIban(seller.iban)}`, seller.bic ? `BIC ${seller.bic}` : ""],
      ]
      const columnWidth = WIDTH / 3
      columns.forEach((lines, columnIndex) => {
        lines.filter(Boolean).forEach((line, lineIndex) => {
          text(line, PAGE.left + columnIndex * columnWidth, top + 9 + lineIndex * 10.5, { width: columnWidth - 8 })
        })
      })
      doc.fillColor("#94a3b8").fontSize(7)
      text(t.credit, PAGE.left, PAGE.height - 28, { width: WIDTH / 2 })
      text(t.page(index + 1, range.count), PAGE.left, PAGE.height - 28, { width: WIDTH, align: "right" })
    }

    doc.end()
  })
}

/** "DE89370400440532013000" becomes "DE89 3704 0044 0532 0130 00". */
function formatIban(iban) {
  return String(iban ?? "").replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim()
}
