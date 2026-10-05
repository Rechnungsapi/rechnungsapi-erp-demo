import { EInvoiceError } from "./einvoice.js"

/** An error the demo wants the browser to see: a status, a stable code and details. */
export class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code      Stable, machine-readable (the UI translates it).
   * @param {string} [message] Plain-English fallback.
   * @param {Record<string, unknown>} [details]
   */
  constructor(status, code, message = code, details = {}) {
    super(message)
    this.name = "AppError"
    this.status = status
    this.code = code
    this.details = details
  }
}

/** HTTP status for each way the e-invoice service can fail. */
const STATUS_BY_CODE = {
  no_token: 503,
  unauthorized: 502,
  no_access: 402,
  missing_fields: 422,
  bad_input: 422,
  rate_limited: 429,
  conflict: 409,
  timeout: 504,
  unreachable: 502,
  upstream: 502,
}

/** Express error middleware. Turns every failure into the same JSON shape. */
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...err.details })
  }
  if (err instanceof EInvoiceError) {
    const status = STATUS_BY_CODE[err.code] ?? 502
    return res.status(status).json({ error: err.code, message: err.message, ...err.details })
  }
  // body-parser: payload too large, malformed JSON.
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload_too_large", message: "The file is too large." })
  }
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "invalid_json", message: "The request body is not valid JSON." })
  }

  // Anything else is a bug. Log it without request data, answer with a generic message.
  console.error("[server] unexpected error:", err?.stack ?? err)
  res.status(500).json({ error: "internal_error", message: "Something went wrong on the server." })
}
