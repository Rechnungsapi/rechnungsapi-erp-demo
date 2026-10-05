import express from "express"
import { round2 } from "../../shared/money.js"
import { MAX_UPLOAD_MB } from "../config.js"

/** Status, numbers for the dashboard and housekeeping. @param {import("../app.js").Context} ctx */
export function miscRouter({ store, einvoice, config, version }) {
  const router = express.Router()

  router.get("/health", (req, res) => {
    res.json({ ok: true, version })
  })

  /** What the UI needs to know about this server. It never includes the token. */
  router.get("/config", (req, res) => {
    res.json({ version, tokenConfigured: einvoice.configured, mock: config.mock, maxUploadMb: MAX_UPLOAD_MB })
  })

  router.get("/stats", (req, res) => {
    const invoices = store.list("invoices")
    const valid = invoices.filter((record) => record.status === "valid").length
    res.json({
      invoices: invoices.length,
      valid,
      invalid: invoices.length - valid,
      volume: round2(invoices.reduce((sum, record) => sum + record.totals.gross, 0)),
      zugferd: invoices.filter((record) => record.format === "zugferd").length,
      xrechnung: invoices.filter((record) => record.format === "xrechnung").length,
      incoming: store.list("incoming").length,
      apiCalls: store.list("activity").length,
    })
  })

  /** The latest API calls: SDK method, outcome and duration. No tokens, no invoice data. */
  router.get("/activity", (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
    res.json(store.list("activity").slice(0, limit))
  })

  /** Deletes everything and starts again with the sample data. */
  router.post("/demo/reset", async (req, res) => {
    await store.reset()
    res.status(204).end()
  })

  return router
}
