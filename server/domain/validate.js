import { COUNTRIES, FORMATS, LANGUAGES, UNITS } from "../../shared/constants.js"
import { daysBetween, isIsoDate } from "../../shared/dates.js"
import { isValidIban, normalizeIban } from "../../shared/iban.js"
import { VAT_RATES, computeTotals, round } from "../../shared/money.js"
import { AppError } from "../http-errors.js"

// Everything that comes from the browser is checked here before it is stored or sent to the API.
// A failure answers 422 with one stable code per field, which the UI translates and highlights.

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const VAT_ID = /^[A-Z]{2}[A-Z0-9]{2,12}$/
const INVOICE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/
const MAX_LINES = 100

/** Collects field errors; the first error of a field wins. */
function collector() {
  /** @type {Record<string, string>} */
  const fields = {}
  return {
    fields,
    fail(field, code) {
      fields[field] ??= code
    },
    /** A trimmed string; fails when it is missing (if required) or too long. */
    text(field, value, { required = false, max = 200 } = {}) {
      const text = typeof value === "string" ? value.trim() : ""
      if (!text) {
        if (required) fields[field] ??= "required"
      } else if (text.length > max) {
        fields[field] ??= "too_long"
      }
      return text
    },
    done() {
      if (Object.keys(fields).length) throw new AppError(422, "validation", "Some fields are missing or invalid.", { fields })
    },
  }
}

const asNumber = (value) => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN)
const hasAtMostDecimals = (value, digits) => Math.abs(round(value, digits) - value) < 1e-9
const isEmail = (value) => value.length <= 254 && EMAIL.test(value)
const emailList = (value) => value.split(/[,;]/).map((item) => item.trim()).filter(Boolean)

// --- Company, customers and defaults ----------------------------------------------------------------

/** @param {unknown} input @returns {import("../../shared/types.js").Company} */
export function parseCompany(input) {
  const body = /** @type {Record<string, unknown>} */ (input && typeof input === "object" ? input : {})
  const c = collector()
  const company = {
    name: c.text("name", body.name, { required: true, max: 120 }),
    street: c.text("street", body.street, { required: true, max: 120 }),
    zip: c.text("zip", body.zip, { required: true, max: 12 }),
    city: c.text("city", body.city, { required: true, max: 80 }),
    country: c.text("country", body.country, { required: true, max: 2 }).toUpperCase(),
    vatId: c.text("vatId", body.vatId, { required: true, max: 14 }).replace(/\s+/g, "").toUpperCase(),
    email: c.text("email", body.email, { required: true, max: 254 }),
    phone: c.text("phone", body.phone, { required: true, max: 40 }),
    contactName: c.text("contactName", body.contactName, { required: true, max: 80 }),
    iban: normalizeIban(c.text("iban", body.iban, { required: true, max: 42 })),
    bic: c.text("bic", body.bic, { max: 11 }).replace(/\s+/g, "").toUpperCase(),
    website: c.text("website", body.website, { max: 120 }),
  }
  if (company.country && !COUNTRIES.some((country) => country.code === company.country)) c.fail("country", "invalid")
  if (company.vatId && !VAT_ID.test(company.vatId)) c.fail("vatId", "invalid")
  if (company.email && !isEmail(company.email)) c.fail("email", "invalid")
  if (company.iban && !isValidIban(company.iban)) c.fail("iban", "invalid")
  if (company.bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(company.bic)) c.fail("bic", "invalid")
  c.done()
  return company
}

/** @param {unknown} input @returns {import("../../shared/types.js").Defaults} */
export function parseDefaults(input) {
  const body = /** @type {Record<string, unknown>} */ (input && typeof input === "object" ? input : {})
  const c = collector()
  const paymentDays = asNumber(body.paymentDays)
  if (!Number.isInteger(paymentDays) || paymentDays < 0 || paymentDays > 365) c.fail("paymentDays", "invalid")
  const vatRate = asNumber(body.vatRate)
  if (!VAT_RATES.includes(vatRate)) c.fail("vatRate", "invalid")
  if (!LANGUAGES.includes(/** @type {any} */ (body.language))) c.fail("language", "invalid")
  if (!FORMATS.includes(/** @type {any} */ (body.format))) c.fail("format", "invalid")
  c.done()
  return { paymentDays, vatRate, language: /** @type {any} */ (body.language), format: /** @type {any} */ (body.format) }
}

/** @param {unknown} input @returns {Omit<import("../../shared/types.js").Customer, "id">} */
export function parseCustomer(input) {
  const body = /** @type {Record<string, unknown>} */ (input && typeof input === "object" ? input : {})
  const c = collector()
  const customer = {
    name: c.text("name", body.name, { required: true, max: 120 }),
    street: c.text("street", body.street, { required: true, max: 120 }),
    zip: c.text("zip", body.zip, { required: true, max: 12 }),
    city: c.text("city", body.city, { required: true, max: 80 }),
    country: c.text("country", body.country, { required: true, max: 2 }).toUpperCase(),
    vatId: c.text("vatId", body.vatId, { max: 14 }).replace(/\s+/g, "").toUpperCase(),
    email: c.text("email", body.email, { required: true, max: 254 }),
    buyerReference: c.text("buyerReference", body.buyerReference, { max: 100 }),
  }
  if (customer.country && !COUNTRIES.some((country) => country.code === customer.country)) c.fail("country", "invalid")
  if (customer.vatId && !VAT_ID.test(customer.vatId)) c.fail("vatId", "invalid")
  if (customer.email && !isEmail(customer.email)) c.fail("email", "invalid")
  c.done()
  return customer
}

// --- The invoice form -------------------------------------------------------------------------------

/**
 * Checks what the invoice form sends and returns it cleaned up.
 *
 * @param {unknown} input
 * @param {{ customers: import("../../shared/types.js").Customer[], settings: import("../../shared/types.js").Settings }} context
 */
export function parseDraft(input, { customers, settings }) {
  const body = /** @type {Record<string, any>} */ (input && typeof input === "object" ? input : {})
  const c = collector()

  const customer = customers.find((item) => item.id === body.customerId)
  if (!customer) c.fail("customerId", body.customerId ? "unknown" : "required")

  const format = FORMATS.includes(body.format) ? body.format : settings.defaults.format
  const language = LANGUAGES.includes(body.language) ? body.language : settings.defaults.language

  const number = c.text("number", body.number, { max: 40 })
  if (number && !INVOICE_NUMBER.test(number)) c.fail("number", "invalid")

  const issueDate = c.text("issueDate", body.issueDate, { required: true, max: 10 })
  const dueDate = c.text("dueDate", body.dueDate, { required: true, max: 10 })
  const deliveryDate = c.text("deliveryDate", body.deliveryDate, { max: 10 })
  if (issueDate && !isIsoDate(issueDate)) c.fail("issueDate", "invalid")
  if (dueDate && !isIsoDate(dueDate)) c.fail("dueDate", "invalid")
  if (deliveryDate && !isIsoDate(deliveryDate)) c.fail("deliveryDate", "invalid")
  if (isIsoDate(issueDate) && isIsoDate(dueDate) && daysBetween(issueDate, dueDate) < 0) c.fail("dueDate", "date_order")

  // XRechnung requires a buyer reference (BT-10), for example a Leitweg-ID or an order number.
  const buyerReference = c.text("buyerReference", body.buyerReference, { max: 100 })
  if (format === "xrechnung" && !buyerReference) c.fail("buyerReference", "required")
  const orderReference = c.text("orderReference", body.orderReference, { max: 100 })
  const paymentTerms = c.text("paymentTerms", body.paymentTerms, { max: 500 })
  const note = c.text("note", body.note, { max: 1000 })
  const exemptionReason = c.text("exemptionReason", body.exemptionReason, { max: 200 })

  /** @type {import("../../shared/types.js").Line[]} */
  const lines = []
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length === 0) c.fail("lines", "required")
  if (rawLines.length > MAX_LINES) c.fail("lines", "too_many")
  rawLines.slice(0, MAX_LINES).forEach((raw, index) => {
    const line = raw && typeof raw === "object" ? raw : {}
    const at = (name) => `lines.${index}.${name}`
    const description = c.text(at("description"), line.description, { required: true, max: 500 })
    const quantity = asNumber(line.quantity)
    if (!(quantity > 0)) c.fail(at("quantity"), "invalid")
    else if (quantity > 1_000_000) c.fail(at("quantity"), "too_large")
    else if (!hasAtMostDecimals(quantity, 4)) c.fail(at("quantity"), "decimals")
    const unitPrice = asNumber(line.unitPrice)
    if (!(unitPrice >= 0)) c.fail(at("unitPrice"), "invalid")
    else if (unitPrice > 10_000_000) c.fail(at("unitPrice"), "too_large")
    else if (!hasAtMostDecimals(unitPrice, 4)) c.fail(at("unitPrice"), "decimals")
    const unit = UNITS.some((item) => item.code === line.unit) ? line.unit : "C62"
    const vatRate = asNumber(line.vatRate)
    if (!VAT_RATES.includes(vatRate)) c.fail(at("vatRate"), "invalid")
    lines.push({ description, quantity, unit, unitPrice, vatRate })
  })
  if (lines.some((line) => line.vatRate === 0) && !exemptionReason) c.fail("exemptionReason", "required")

  // Optional: send the invoice by e-mail in the same API call.
  /** @type {import("../../shared/types.js").Transport | undefined} */
  let transport
  const mail = body.transport
  if (mail && typeof mail === "object" && mail.enabled) {
    const sender = c.text("transport.sender", mail.sender, { required: true, max: 254 })
    const receiver = c.text("transport.receiver", mail.receiver, { required: true, max: 500 })
    const cc = c.text("transport.cc", mail.cc, { max: 500 })
    const bcc = c.text("transport.bcc", mail.bcc, { max: 500 })
    if (sender && !isEmail(sender)) c.fail("transport.sender", "invalid")
    for (const [field, value] of [["receiver", receiver], ["cc", cc], ["bcc", bcc]]) {
      if (value && !emailList(value).every(isEmail)) c.fail(`transport.${field}`, "invalid")
    }
    transport = {
      sender,
      senderName: c.text("transport.senderName", mail.senderName, { max: 100 }) || undefined,
      receiver: emailList(receiver).join(", "),
      cc: emailList(cc).join(", ") || undefined,
      bcc: emailList(bcc).join(", ") || undefined,
      subject: c.text("transport.subject", mail.subject, { required: true, max: 200 }),
      message: c.text("transport.message", mail.message, { required: true, max: 5000 }),
    }
  }

  c.done()

  const totals = computeTotals(lines)
  if (totals.gross > 999_999_999.99) throw new AppError(422, "validation", "The total is too large.", { fields: { lines: "too_large" } })

  return {
    customer: /** @type {import("../../shared/types.js").Customer} */ (customer),
    draft: {
      number: number || undefined,
      issueDate,
      dueDate,
      deliveryDate: deliveryDate || undefined,
      format,
      language,
      buyerReference: buyerReference || undefined,
      orderReference: orderReference || undefined,
      paymentTerms: paymentTerms || defaultPaymentTerms(language, daysBetween(issueDate, dueDate)),
      note: note || undefined,
      exemptionReason: exemptionReason || undefined,
      lines,
      transport,
    },
    totals,
  }
}

/** "Zahlbar innerhalb von 14 Tagen ohne Abzug." (or the English sentence). */
export function defaultPaymentTerms(language, days) {
  if (days <= 0) return language === "de" ? "Zahlbar sofort ohne Abzug." : "Payable immediately without deduction."
  return language === "de" ? `Zahlbar innerhalb von ${days} Tagen ohne Abzug.` : `Payable within ${days} days without deduction.`
}

// --- Completeness: what an XRechnung needs from you and from your customer ----------------------------------

const SELLER_REQUIRED = ["name", "street", "zip", "city", "country", "vatId", "email", "phone", "contactName", "iban"]
const BUYER_REQUIRED = ["name", "street", "zip", "city", "country", "email"]

/** Fields of the company profile that are still empty. */
export const missingSellerFields = (company) => SELLER_REQUIRED.filter((field) => !String(company?.[field] ?? "").trim())

/** Fields of the customer that are still empty. */
export const missingBuyerFields = (customer) => BUYER_REQUIRED.filter((field) => !String(customer?.[field] ?? "").trim())
