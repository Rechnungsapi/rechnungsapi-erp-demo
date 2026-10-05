// The whole RechnungsAPI integration lives in this file.
//
// Every call goes through the official SDK (rechnungsapi-sdk). The rest of the demo never sees an
// HTTP status, a field name from the API or the token: it gets plain results and plain errors.
// To add e-invoicing to your own ERP, this is the file to read, copy and adapt.

import { RechnungsApiClient, RechnungsApiError, ValidationFailedError } from "rechnungsapi-sdk"

/** Everything that can go wrong when talking to RechnungsAPI, reduced to a stable `code`. */
export class EInvoiceError extends Error {
  /**
   * @param {"no_token"|"unauthorized"|"no_access"|"missing_fields"|"bad_input"|"rate_limited"|"conflict"|"timeout"|"unreachable"|"upstream"} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = "EInvoiceError"
    this.code = code
    this.details = details
  }
}

/**
 * @param {{
 *   token?: string,
 *   baseUrl?: string,
 *   v2BaseUrl?: string,
 *   fetch?: typeof fetch,
 *   onCall?: (call: { name: string, ok: boolean, ms: number, code?: string }) => void,
 * }} options
 */
export function createEInvoice({ token, baseUrl, v2BaseUrl, fetch: fetchImpl, onCall = () => {} }) {
  const client = token ? new RechnungsApiClient({ apiToken: token, baseUrl, v2BaseUrl, fetch: fetchImpl }) : null

  /** Runs one SDK call, measures it and turns every failure into an EInvoiceError. */
  async function call(name, run) {
    if (!client) throw new EInvoiceError("no_token", "No RECHNUNGSAPI_TOKEN is configured.")
    const started = Date.now()
    try {
      const result = await run(client)
      onCall({ name, ok: true, ms: Date.now() - started })
      return result
    } catch (error) {
      const failure = translate(error)
      onCall({ name, ok: false, ms: Date.now() - started, code: failure.code })
      throw failure
    }
  }

  return {
    /** False until a token is set; every call then fails with "no_token". */
    configured: Boolean(client),

    /** Invoice JSON + the visual PDF in, ZUGFeRD PDF/A-3 out. Optionally e-mails it in the same call. */
    createZugferd: (invoice, visualPdf, transport) =>
      call("createZugferdFromJson", async (api) => {
        const raw = await api.createZugferdFromJson(invoice, visualPdf.toString("base64"), withTransport(transport))
        if (!raw.zugferd) throw new EInvoiceError("upstream", "The API answered without a ZUGFeRD document.")
        const flags = [raw.zugferdValid, raw.xInvoiceValid].filter((flag) => typeof flag === "boolean")
        const issues = issuesOf(raw.zugferdErrorList ?? raw.zugferdErrors, raw.xInvoiceErrorList)
        return {
          valid: flags.length ? flags.every(Boolean) : !issues.some((issue) => issue.severity === "error"),
          issues,
          message: raw.message,
          pdf: Buffer.from(raw.zugferd, "base64"),
          xml: typeof raw.xInvoice === "string" ? raw.xInvoice : undefined,
          emailQueued: Boolean(raw.resendToken),
        }
      }),

    /** Invoice JSON in, XRechnung XML out. Optionally e-mails it in the same call. */
    createXRechnung: (invoice, transport) =>
      call("createXRechnungFromJson", async (api) => {
        const raw = await api.createXRechnungFromJson(invoice, withTransport(transport))
        if (!raw.xInvoice) throw new EInvoiceError("upstream", "The API answered without an XRechnung document.")
        const issues = issuesOf(raw.xInvoiceErrors)
        return {
          valid: typeof raw.valid === "boolean" ? raw.valid : !issues.some((issue) => issue.severity === "error"),
          issues,
          message: raw.message,
          xml: String(raw.xInvoice),
          emailQueued: Boolean(raw.resendToken),
        }
      }),

    /** Checks an XRechnung XML against EN 16931 and the XRechnung rules. */
    validateXml: (xml) =>
      call("validateXRechnungXml", async (api) => {
        const result = await api.validateXRechnungXml(xml)
        return { valid: result.isValid, issues: issuesOf(result.messages), message: result.message }
      }),

    /** Checks a ZUGFeRD PDF: the PDF/A-3 container and the XML embedded in it. */
    validatePdf: (pdf, { compareWithXml = false } = {}) =>
      call("validateZugferdPdf", async (api) => {
        const raw = await api.validateZugferdPdf(pdf.toString("base64"), { comparePDF2XML: compareWithXml })
        const issues = issuesOf(raw.zugferdErrors ?? raw.zugferdErrorList)
        const flag = typeof raw.valid === "boolean" ? raw.valid : raw.zugferdValid
        return { valid: typeof flag === "boolean" ? flag : issues.length === 0, issues, message: raw.message }
      }),

    /** Reads the structured invoice data that is embedded in a ZUGFeRD PDF. */
    extract: (pdf) =>
      call("extractXRechnungFromZugferd", async (api) => {
        const raw = await api.extractXRechnungFromZugferd(pdf.toString("base64"))
        return { invoice: raw.extractedInvoice ?? raw }
      }),

    /** Reads any invoice (PDF, scan, photo) with AI and returns structured data. */
    read: (file, { withLineItems = true } = {}) =>
      call("analyzePdfInvoiceV2", async (api) => {
        const raw = await api.analyzePdfInvoiceV2(file.toString("base64"), withLineItems)
        return { confidence: raw.extractionConfidence, invoice: raw.invoice ?? {} }
      }),

    /** Turns any invoice PDF or scan into a validated ZUGFeRD PDF in one call. */
    convert: (file, fileName) =>
      call("createZugferdFromPdf", async (api) => {
        const result = await api.createZugferdFromPdf(file.toString("base64"), fileName)
        if (result.ok) {
          return { ok: true, pdf: Buffer.from(result.pdfBase64, "base64"), fileName: result.fileName, reference: result.reference }
        }
        const { error } = result.body
        return {
          ok: false,
          status: result.status,
          code: error.code,
          message: error.userMessage,
          retryable: error.retryable,
          reference: error.reference,
          rules: error.ruleCodes ?? [],
        }
      }),
  }
}

const withTransport = (transport) => (transport ? { transport: { type: "email", useTransport: true, ...transport } } : {})

/**
 * Validation findings come in several shapes depending on the endpoint
 * (xInvoiceErrors, zugferdErrors, ...). This maps them all to one.
 *
 * @param {...Array<Record<string, any>>|undefined} lists
 * @returns {import("../shared/types.js").Issue[]}
 */
export function issuesOf(...lists) {
  const seen = new Set()
  const issues = []
  for (const item of lists.flatMap((list) => (Array.isArray(list) ? list : []))) {
    const issue = {
      rule: String(item.id ?? item.BusinessTerm ?? item.businessTerm ?? item.code ?? ""),
      severity: severityOf(item.type ?? item.severity),
      message: String(item.message ?? item.errormessage ?? item.businessTermDescription ?? ""),
      location: item.location ? String(item.location) : undefined,
      source: item.schemaFile ? String(item.schemaFile) : undefined,
    }
    const key = `${issue.rule}|${issue.message}|${issue.location}`
    if (seen.has(key)) continue
    seen.add(key)
    issues.push(issue)
  }
  return issues
}

/** @returns {"error"|"warning"|"info"} */
function severityOf(type) {
  const text = String(type ?? "fatal").toLowerCase()
  if (text === "warning" || text === "warn") return "warning"
  if (text === "info" || text === "information") return "info"
  return "error"
}

/** Maps the SDK's errors, and network failures, to an EInvoiceError. */
function translate(error) {
  if (error instanceof EInvoiceError) return error

  if (error instanceof ValidationFailedError) {
    const missing = /** @type {any[]} */ (error.errorlist).map((item) => ({
      rule: String(item?.BusinessTerm ?? item?.businessTerm ?? ""),
      message: String(item?.message ?? item?.errormessage ?? item?.businessTermDescription ?? ""),
    }))
    return new EInvoiceError("missing_fields", "The invoice is missing mandatory data.", { missing })
  }

  if (error instanceof RechnungsApiError) {
    return new EInvoiceError(codeForStatus(error.status), error.message, { upstreamStatus: error.status })
  }

  if (error?.name === "AbortError" || error?.name === "TimeoutError") {
    return new EInvoiceError("timeout", "RechnungsAPI did not answer in time.")
  }
  if (error instanceof TypeError) {
    return new EInvoiceError("unreachable", "RechnungsAPI could not be reached.")
  }
  return new EInvoiceError("upstream", "Unexpected error while calling RechnungsAPI.")
}

function codeForStatus(status) {
  if (status === 401 || status === 403) return "unauthorized"
  if (status === 402) return "no_access"
  if (status === 409) return "conflict"
  if (status === 429) return "rate_limited"
  if (status >= 400 && status < 500) return "bad_input"
  return "upstream"
}
