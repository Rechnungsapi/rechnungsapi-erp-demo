import http from "node:http"

// A local stand-in for the RechnungsAPI gateway, for tests and UI development only.
//
// It speaks the same routes and answer shapes as the documented API, and it applies the EN 16931
// arithmetic rules (BR-CO-10 to BR-CO-17 and a few more), so a test can prove that the invoice the
// demo builds would pass a validator. The documents it returns are simplified placeholders: the real
// XML, PDF/A-3 and validation come from RechnungsAPI. Never use this to judge compliance.

const MARKER = "%mock-zugferd:"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cents = (value) => Math.round(Number(value) * 100)
const close = (a, b) => Math.abs(cents(a) - cents(b)) === 0
const arr = (value) => (Array.isArray(value) ? value : [])

/**
 * @param {{ port?: number, latencyMs?: number, log?: boolean }} [options]
 */
export async function startMockGateway({ port = 0, latencyMs = 0, log = false } = {}) {
  /** Every request the gateway received, for assertions. @type {Array<{ method: string, path: string, token: string, body: any }>} */
  const calls = []
  const state = {
    /** Set to { status, body } to make every following request fail. */
    fail: /** @type {null | { status: number, body?: unknown }} */ (null),
  }

  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://mock").pathname
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")
    const body = await readJson(req)
    calls.push({ method: req.method ?? "", path, token, body })
    if (latencyMs) await sleep(latencyMs)

    const send = (status, payload, headers = {}) => {
      if (log) console.log(`  [mock gateway] ${req.method} ${path} -> ${status}`)
      const isBuffer = Buffer.isBuffer(payload)
      res.writeHead(status, { "Content-Type": isBuffer ? "application/pdf" : "application/json", ...headers })
      res.end(isBuffer ? payload : JSON.stringify(payload))
    }

    if (state.fail) return send(state.fail.status, state.fail.body ?? { message: "Mock failure" })
    if (!token || token === "invalid-token") return send(401, { error: "Invalid token." })

    try {
      const handler = ROUTES[path]
      if (!handler || req.method !== "POST") return send(404, { message: "Not found" })
      const answer = handler(body ?? {})
      return send(answer.status, answer.body, answer.headers)
    } catch (error) {
      return send(500, { message: String(error?.message ?? error) })
    }
  })

  await new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(undefined)))
  const { port: actualPort } = /** @type {import("node:net").AddressInfo} */ (server.address())

  return {
    url: `http://127.0.0.1:${actualPort}`,
    calls,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  }
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")
  } catch {
    return null
  }
}

// --- Routes ---------------------------------------------------------------------------------------

const ok = (body, headers) => ({ status: 200, body, headers })

const ROUTES = {
  "/api/v1/zugferd/createXinvoiceFromJson": ({ invoice, transport }) => {
    if (!invoice) return { status: 412, body: { message: "No invoice data transmitted." } }
    const missing = missingData(invoice, "xrechnung")
    if (missing.length) return missingResponse(missing)
    const issues = checkInvoice(invoice, "xrechnung")
    return ok({
      message: "xInvoice generated",
      downloadURL: "http://mock/download/xinvoice.xml",
      ...(transport?.useTransport && !issues.length ? { resendToken: "mock-resend-token" } : {}),
      valid: issues.length === 0,
      numberOfXInvoiceErrors: issues.length,
      xInvoiceErrors: issues,
      xInvoice: buildXml(invoice),
    })
  },

  "/api/v1/zugferd/createZugferdFromJson": ({ invoice, invoicePdf64, transport }) => {
    if (!invoice || !invoicePdf64) return { status: 412, body: { message: "No invoice file or invoice data transmitted." } }
    const missing = missingData(invoice, "zugferd")
    if (missing.length) return missingResponse(missing)
    const issues = checkInvoice(invoice, "zugferd")
    const pdf = embed(Buffer.from(invoicePdf64, "base64"), invoice)
    return ok({
      message: "ZUGFeRD created",
      downloadURL: "http://mock/download/zugferd.pdf",
      ...(transport?.useTransport && !issues.length ? { resendToken: "mock-resend-token" } : {}),
      zugferdValid: issues.length === 0,
      xInvoiceValid: issues.length === 0,
      numberOfZugferdErrors: issues.length,
      numberOfxInvoiceErrors: issues.length,
      zugferd: pdf.toString("base64"),
      zugferdErrorList: issues,
      xInvoice: buildXml(invoice),
      xInvoiceErrorList: issues,
    })
  },

  "/api/v1/zugferd/validateXinvoiceXml": ({ xinvoiceXML }) => {
    if (!xinvoiceXML) return { status: 412, body: { message: "No XML data transmitted." } }
    const issues = []
    if (!String(xinvoiceXML).includes("CrossIndustryInvoice")) {
      issues.push(issue("SCHEMA", "Content is not allowed in prolog: the document is not a CII invoice.", "/"))
    } else {
      if (!/<ram:BuyerReference>[^<]+<\/ram:BuyerReference>/.test(xinvoiceXML)) {
        issues.push(issue("BR-DE-15", "The element Buyer reference (BT-10) must be transmitted.", "/rsm:CrossIndustryInvoice"))
      }
      if (!/<ram:GrandTotalAmount>/.test(xinvoiceXML)) {
        issues.push(issue("BR-14", "An Invoice shall have the Invoice total amount with VAT (BT-112).", "/rsm:CrossIndustryInvoice"))
      }
    }
    return ok({ valid: issues.length === 0, message: "validated. (mock)", xInvoiceErrors: issues })
  },

  "/api/v1/zugferd/validateZugferdPdf": ({ zugferdFile64 }) => {
    if (!zugferdFile64) return { status: 412, body: { message: "No ZUGFeRD file transmitted." } }
    const pdf = Buffer.from(zugferdFile64, "base64")
    const issues = []
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") issues.push(issue("PDF", "The file is not a PDF.", "/"))
    else if (!pdf.includes(MARKER)) issues.push(issue("ZUGFERD-XML-MISSING", "No embedded XML invoice was found in the PDF.", "/"))
    return ok({ valid: issues.length === 0, message: "File was validated (mock)", numberOfZugferdErrors: issues.length, zugferdErrors: issues })
  },

  "/api/v1/zugferd/extractXinvoiceFromZugferdToJson": ({ zugferd64 }) => {
    const pdf = Buffer.from(String(zugferd64 ?? ""), "base64")
    const at = pdf.indexOf(MARKER)
    if (at === -1) return { status: 400, body: { message: "No embedded XML invoice was found in the PDF." } }
    const encoded = pdf.subarray(at + MARKER.length).toString("latin1").split("\n")[0]
    return ok({ extractedInvoice: JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) })
  },

  // --- v2 host ---
  "/createJSONFromAnalysedPdf": ({ pdfInvoiceBase64, withLineItems }) => {
    const file = Buffer.from(String(pdfInvoiceBase64 ?? ""), "base64")
    if (!isDocument(file)) return failureEnvelope(400, "PDF_CORRUPT", "Die Datei ist kein lesbares PDF oder Bild.")
    const { invoiceLine, ...header } = SAMPLE_EXTRACTION
    return ok({ extractionConfidence: 96, invoice: withLineItems === false ? header : { ...header, invoiceLine } })
  },

  "/createZugferdFromPdf": ({ pdfInvoiceBase64, fileName }) => {
    const file = Buffer.from(String(pdfInvoiceBase64 ?? ""), "base64")
    if (!isDocument(file)) return failureEnvelope(400, "PDF_CORRUPT", "Die Datei ist kein lesbares PDF oder Bild.")
    if (/unreadable/i.test(String(fileName ?? ""))) {
      return failureEnvelope(422, "EXTRACTION_LOW_CONFIDENCE", "Der Text konnte nicht sicher gelesen werden.")
    }
    const source = file.subarray(0, 5).toString("latin1") === "%PDF-" ? file : Buffer.from("%PDF-1.4\n%mock\n%%EOF\n")
    const name = String(fileName ?? "invoice.pdf").replace(/\.[^.]+$/, "")
    return ok(embed(source, SAMPLE_EXTRACTION), {
      "Content-Disposition": `attachment; filename="${name}-zugferd.pdf"`,
      "X-Zugferd-Status": "success",
      "X-Zugferd-Reference": "ZAPI-MOCK-1",
    })
  },
}

const isDocument = (file) =>
  file.subarray(0, 5).toString("latin1") === "%PDF-" || (file[0] === 0x89 && file[1] === 0x50) || (file[0] === 0xff && file[1] === 0xd8)

function failureEnvelope(status, code, userMessage) {
  return {
    status,
    body: {
      success: false,
      error: { code, stage: "input", httpStatus: status, retryable: false, userMessage, detail: "mock", reference: "ZAPI-MOCK-ERR" },
      email: { subject: "", text: "", html: "" },
    },
  }
}

/** Appends the invoice as a trailing PDF comment, so the mock can "extract" it again. */
const embed = (pdf, invoice) => Buffer.concat([pdf, Buffer.from(`\n${MARKER}${Buffer.from(JSON.stringify(invoice)).toString("base64")}\n`)])

const issue = (id, message, location) => ({ id, type: "fatal", schemaFile: "EN16931-CII-validation", location, message, line: null })

// --- What the real API checks: mandatory data (answered with 412) ---------------------------------

function missingData(invoice, format) {
  const missing = []
  const need = (term, value, message) => {
    if (value === undefined || value === null || value === "") missing.push({ BusinessTerm: term, message })
  }
  const seller = invoice.seller ?? {}
  const buyer = invoice.buyer ?? {}
  need("BT-1", invoice.invoiceNumber, "Invoice number is mandatory.")
  need("BT-2", invoice.invoiceIssueDate, "Invoice issue date is mandatory.")
  need("BT-27", seller.sellerName, "Seller name is mandatory.")
  need("BT-31", seller.sellerVatIdentifier, "Seller VAT identifier is mandatory.")
  need("BT-37", seller.sellerPostalAddress?.sellerCity, "Seller city is mandatory.")
  need("BT-40", seller.sellerPostalAddress?.sellerCountryCode, "Seller country code is mandatory.")
  need("BT-44", buyer.buyerName, "Buyer name is mandatory.")
  need("BT-52", buyer.buyerPostalAddress?.buyerCity, "Buyer city is mandatory.")
  if (format === "xrechnung") {
    need("BT-41", seller.sellerContact?.sellerContactPoint, "Seller contact point is mandatory for XRechnung.")
    need("BT-42", seller.sellerContact?.sellerContactTelephoneNumber, "Seller telephone is mandatory for XRechnung.")
    need("BT-43", seller.sellerContact?.sellerContactEmailAddress, "Seller e-mail is mandatory for XRechnung.")
  }
  if (arr(invoice.invoiceLine).length === 0) missing.push({ BusinessTerm: "BG-25", message: "At least one invoice line is mandatory." })
  return missing
}

const missingResponse = (missing) => ({
  status: 412,
  body: { message: "Data validation failed", noOfMissingData: missing.length, errorlist: missing },
})

// --- What the real API checks: EN 16931 rules (answered with 200 and a list of findings) ----------

function checkInvoice(invoice, format) {
  const issues = []
  const rule = (id, message, location = "/rsm:CrossIndustryInvoice") => issues.push(issue(id, message, location))
  const lines = arr(invoice.invoiceLine)
  const totals = invoice.documentTotals ?? {}
  const breakdown = arr(invoice.vatBreakdown)

  if (hasEmptyValue(invoice)) rule("PEPPOL-EN16931-R008", "Document MUST not contain empty elements.")

  const lineSum = lines.reduce((sum, line) => sum + cents(line.invoiceLineNetAmount), 0) / 100
  for (const line of lines) {
    if (!close(line.invoiceLineNetAmount, Number(line.invoicedQuantity) * Number(line.priceDetails?.itemNetPrice))) {
      rule("PEPPOL-EN16931-R120", `Invoice line ${line.invoiceLineIdentifier}: the net amount must equal quantity times item net price.`)
    }
    const price = line.priceDetails ?? {}
    if (price.itemGrossPrice !== undefined && !close(price.itemNetPrice, Number(price.itemGrossPrice) - Number(price.itemPriceDiscount ?? 0))) {
      rule("PEPPOL-EN16931-R046", "Item net price MUST equal (Gross price - Price discount) if gross price is provided.")
    }
  }
  if (!close(totals.sumOfInvoiceLineNetAmount, lineSum)) rule("BR-CO-10", "Sum of Invoice line net amount = Σ Invoice line net amount.")
  if (!close(totals.invoiceTotalAmountWithoutVat, Number(totals.sumOfInvoiceLineNetAmount) - Number(totals.sumOfAllowancesOnDocumentLevel ?? 0) + Number(totals.sumOfChargesOnDocumentLevel ?? 0))) {
    rule("BR-CO-13", "Invoice total amount without VAT = Σ Invoice line net amount - allowances + charges.")
  }
  for (const group of breakdown) {
    const expected = Math.round((cents(group.vatCategoryTaxableAmount) * Number(group.vatCategoryRate)) / 100) / 100
    if (!close(group.vatCategoryTaxAmount, expected)) rule("BR-CO-17", "VAT category tax amount = VAT category taxable amount x (VAT category rate / 100), rounded to two decimals.")
  }
  const taxSum = breakdown.reduce((sum, group) => sum + cents(group.vatCategoryTaxAmount), 0) / 100
  if (!close(totals.invoiceTotalVatAmount, taxSum)) rule("BR-CO-14", "Invoice total VAT amount = Σ VAT category tax amount.")
  if (!close(totals.invoiceTotalAmountWithVat, Number(totals.invoiceTotalAmountWithoutVat) + Number(totals.invoiceTotalVatAmount))) {
    rule("BR-CO-15", "Invoice total amount with VAT = Invoice total amount without VAT + Invoice total VAT amount.")
  }
  if (!close(totals.amountDueForPayment, Number(totals.invoiceTotalAmountWithVat) - Number(totals.paidAmount ?? 0) + Number(totals.roundingAmount ?? 0))) {
    rule("BR-CO-16", "Amount due for payment = Invoice total amount with VAT - Paid amount + Rounding amount.")
  }
  if (Number(totals.amountDueForPayment) > 0 && !invoice.paymentDueDate && !invoice.paymentTerms) {
    rule("BR-CO-25", "In case the Amount due for payment (BT-115) is positive, either the Payment due date (BT-9) or the Payment terms (BT-20) shall be present.")
  }
  if (breakdown.some((group) => group.vatCategoryCode === "E" && !group.vatExemptionReasonText && !group.vatExemptionReasonCode)) {
    rule("BR-E-10", "A VAT breakdown with the category Exempt from VAT shall have a VAT exemption reason code or text.")
  }
  if (format === "xrechnung" && !invoice.buyerReference) rule("BR-DE-15", "The element Buyer reference (BT-10) must be transmitted.")
  return issues
}

function hasEmptyValue(value) {
  if (value === "") return true
  if (Array.isArray(value)) return value.some(hasEmptyValue)
  if (value && typeof value === "object") return Object.values(value).some(hasEmptyValue)
  return false
}

// --- A simplified CII document (a placeholder for the real XML) -----------------------------------

const esc = (value) => String(value ?? "").replace(/[<>&"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[char])
const ymd = (value) => String(value ?? "").slice(0, 10).replaceAll("-", "")

function buildXml(invoice) {
  const seller = invoice.seller ?? {}
  const buyer = invoice.buyer ?? {}
  const totals = invoice.documentTotals ?? {}
  const lines = arr(invoice.invoiceLine)
    .map(
      (line) => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${esc(line.invoiceLineIdentifier)}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(line.itemInformation?.itemName)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${esc(line.priceDetails?.itemNetPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${esc(line.invoicedQuantityUnitOfMeasureCode)}">${esc(line.invoicedQuantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${esc(line.lineVatInformation?.[0]?.invoicedItemVatCategoryCode)}</ram:CategoryCode><ram:RateApplicablePercent>${esc(line.lineVatInformation?.[0]?.invoicedItemVatRate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${esc(line.invoiceLineNetAmount)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join("\n")
  const taxes = arr(invoice.vatBreakdown)
    .map(
      (group) => `      <ram:ApplicableTradeTax><ram:CalculatedAmount>${esc(group.vatCategoryTaxAmount)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${esc(group.vatCategoryTaxableAmount)}</ram:BasisAmount><ram:CategoryCode>${esc(group.vatCategoryCode)}</ram:CategoryCode><ram:RateApplicablePercent>${esc(group.vatCategoryRate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`,
    )
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Placeholder generated by the local mock gateway. Real documents come from RechnungsAPI. -->
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(invoice.invoiceNumber)}</ram:ID>
    <ram:TypeCode>${esc(invoice.invoiceTypeCode)}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${ymd(invoice.invoiceIssueDate)}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lines}
    <ram:ApplicableHeaderTradeAgreement>
      ${invoice.buyerReference ? `<ram:BuyerReference>${esc(invoice.buyerReference)}</ram:BuyerReference>` : ""}
      <ram:SellerTradeParty><ram:Name>${esc(seller.sellerName)}</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(seller.sellerVatIdentifier)}</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>${esc(buyer.buyerName)}</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${esc(invoice.invoiceCurrencyCode)}</ram:InvoiceCurrencyCode>
${taxes}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${esc(totals.sumOfInvoiceLineNetAmount)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${esc(totals.invoiceTotalAmountWithoutVat)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${esc(invoice.invoiceCurrencyCode)}">${esc(totals.invoiceTotalVatAmount)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${esc(totals.invoiceTotalAmountWithVat)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${esc(totals.amountDueForPayment)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`
}

// --- What "reading an invoice" returns in the mock -----------------------------------------------

const SAMPLE_EXTRACTION = {
  invoiceNumber: "R-2026-0815",
  invoiceIssueDate: "24.08.2026",
  invoiceTypeCode: "380",
  invoiceCurrencyCode: "EUR",
  paymentDueDate: "23.09.2026",
  buyerReference: "PO-2026-4471",
  paymentTerms: "Zahlbar innerhalb von 30 Tagen ohne Abzug.",
  seller: { sellerName: "Beispiel Großhandel GmbH", sellerVatIdentifier: "DE812345678" },
  buyer: { buyerName: "Muster Bäckerei KG" },
  paymentInstructions: {
    paymentMeansTypeCode: "58",
    creditTransfer: [{ paymentAccountIdentifier: "DE89 3704 0044 0532 0130 00", paymentServiceProviderIdentifier: "COBADEFFXXX" }],
  },
  documentTotals: {
    sumOfInvoiceLineNetAmount: 1996.5,
    invoiceTotalAmountWithoutVat: 1996.5,
    invoiceTotalVatAmount: 379.34,
    invoiceTotalAmountWithVat: 2375.84,
    amountDueForPayment: 2375.84,
  },
  vatBreakdown: [{ vatCategoryTaxableAmount: 1996.5, vatCategoryTaxAmount: 379.34, vatCategoryCode: "S", vatCategoryRate: 19 }],
  invoiceLine: [
    {
      invoiceLineIdentifier: "1",
      invoicedQuantity: 12,
      invoicedQuantityUnitOfMeasureCode: "HUR",
      invoiceLineNetAmount: 1740,
      priceDetails: { itemNetPrice: 145 },
      lineVatInformation: [{ invoicedItemVatCategoryCode: "S", invoicedItemVatRate: 19 }],
      itemInformation: { itemName: "Beratungsleistung Softwarearchitektur" },
    },
    {
      invoiceLineIdentifier: "2",
      invoicedQuantity: 3,
      invoicedQuantityUnitOfMeasureCode: "C62",
      invoiceLineNetAmount: 256.5,
      priceDetails: { itemNetPrice: 85.5 },
      lineVatInformation: [{ invoicedItemVatCategoryCode: "S", invoicedItemVatRate: 19 }],
      itemInformation: { itemName: "Schulungsunterlagen" },
    },
  ],
}
