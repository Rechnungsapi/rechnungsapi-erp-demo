import express from "express"
import { missingBuyerFields, missingSellerFields, parseDraft } from "../domain/validate.js"
import { toApiInvoice } from "../domain/to-api.js"
import { AppError } from "../http-errors.js"
import { newId } from "../ids.js"
import { renderInvoicePdf } from "../pdf/invoice-pdf.js"

const FILE_TYPES = { pdf: "application/pdf", xml: "application/xml; charset=utf-8" }

/** The outgoing invoices: create them with RechnungsAPI, look at them, check them again. @param {import("../app.js").Context} ctx */
export function invoicesRouter({ store, einvoice }) {
  const router = express.Router()

  // Creating invoices one at a time keeps the numbers free of gaps, which German law requires.
  let lock = Promise.resolve()
  const withLock = (task) => {
    const run = lock.then(task, task)
    lock = run.catch(() => {})
    return run
  }

  /** Parses a draft and everything derived from it. Nothing is stored and no API call is made. */
  function prepare(body) {
    const settings = store.data.settings
    const { draft, customer, totals } = parseDraft(body, { customers: store.list("customers"), settings })
    const year = Number(draft.issueDate.slice(0, 4))
    const number = draft.number ?? store.peekInvoiceNumber(year)
    const invoice = { ...draft, number, seller: settings.company, buyer: customer, totals }
    return { draft, invoice, year, autoNumber: !draft.number, customer, seller: settings.company }
  }

  const summary = (record) => ({
    id: record.id,
    number: record.number,
    buyerName: record.buyer.name,
    format: record.format,
    status: record.status,
    issueDate: record.issueDate,
    dueDate: record.dueDate,
    gross: record.totals.gross,
    issues: record.result.issues.length,
    createdAt: record.createdAt,
  })

  const view = (record) => ({ ...record, files: { pdf: Boolean(record.files.pdf), xml: Boolean(record.files.xml) } })

  const find = (id) => {
    const record = store.find("invoices", id)
    if (!record) throw new AppError(404, "not_found", "Invoice not found.")
    return record
  }

  router.get("/", (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase()
    const format = String(req.query.format ?? "")
    const status = String(req.query.status ?? "")
    const invoices = store
      .list("invoices")
      .filter((record) => (!format || record.format === format) && (!status || record.status === status))
      .filter((record) => !q || `${record.number} ${record.buyer.name}`.toLowerCase().includes(q))
    res.json(invoices.map(summary))
  })

  // --- Previews: they cost no API credits ---------------------------------------------------------

  router.post("/preview", (req, res) => {
    const { invoice, draft } = prepare(req.body)
    res.json({ number: invoice.number, totals: invoice.totals, payload: toApiInvoice(invoice), format: draft.format })
  })

  router.post("/preview-pdf", async (req, res) => {
    const { invoice } = prepare(req.body)
    const pdf = await renderInvoicePdf(invoice)
    res.set({ "Content-Type": FILE_TYPES.pdf, "Content-Disposition": 'inline; filename="preview.pdf"', "Cache-Control": "no-store" })
    res.send(pdf)
  })

  // --- Create -------------------------------------------------------------------------------------

  router.post("/", (req, res) =>
    withLock(async () => {
      const { draft, invoice, year, autoNumber, customer, seller } = prepare(req.body)

      const missingSeller = missingSellerFields(seller)
      if (missingSeller.length) {
        throw new AppError(409, "seller_incomplete", "Your company profile is incomplete.", { missing: missingSeller })
      }
      const missingBuyer = missingBuyerFields(customer)
      if (missingBuyer.length) {
        throw new AppError(409, "customer_incomplete", "The customer is incomplete.", { missing: missingBuyer, customerId: customer.id })
      }
      if (store.list("invoices").some((record) => record.number === invoice.number)) {
        throw new AppError(409, "number_taken", "This invoice number is already used.", { number: invoice.number })
      }

      const payload = toApiInvoice(invoice)
      /** @type {import("../../shared/types.js").InvoiceResult} */
      let result
      const files = {}

      if (draft.format === "zugferd") {
        const created = await einvoice.createZugferd(payload, await renderInvoicePdf(invoice), draft.transport)
        files.pdf = await store.saveFile(created.pdf, "pdf")
        if (created.xml) files.xml = await store.saveFile(created.xml, "xml")
        result = { valid: created.valid, issues: created.issues, message: created.message, emailQueued: created.emailQueued }
      } else {
        const created = await einvoice.createXRechnung(payload, draft.transport)
        files.xml = await store.saveFile(created.xml, "xml")
        result = { valid: created.valid, issues: created.issues, message: created.message, emailQueued: created.emailQueued }
      }

      const record = {
        id: newId("inv_"),
        number: invoice.number,
        format: draft.format,
        language: draft.language,
        status: result.valid ? "valid" : "invalid",
        issueDate: draft.issueDate,
        dueDate: draft.dueDate,
        deliveryDate: draft.deliveryDate,
        buyerReference: draft.buyerReference,
        orderReference: draft.orderReference,
        paymentTerms: draft.paymentTerms,
        note: draft.note,
        seller,
        buyer: customer,
        lines: draft.lines,
        totals: invoice.totals,
        payload,
        result,
        files,
        // Only who got the invoice is kept, not the message text.
        sentTo: draft.transport?.receiver,
        createdAt: new Date().toISOString(),
      }
      await store.insert("invoices", record)
      if (autoNumber) await store.useInvoiceNumber(year)
      res.status(201).json(view(record))
    }),
  )

  // --- One invoice --------------------------------------------------------------------------------

  router.get("/:id", (req, res) => {
    res.json(view(find(req.params.id)))
  })

  router.get("/:id/files/:kind", async (req, res) => {
    const record = find(req.params.id)
    const kind = req.params.kind === "pdf" || req.params.kind === "xml" ? req.params.kind : null
    const fileId = kind ? record.files[kind] : undefined
    const content = fileId ? await store.readFile(fileId) : null
    if (!kind || !content) throw new AppError(404, "not_found", "File not found.")

    const disposition = req.query.download ? "attachment" : "inline"
    const name = `${record.number.replace(/[^\w.-]+/g, "_")}.${kind}`
    res.set({
      "Content-Type": FILE_TYPES[kind],
      "Content-Disposition": `${disposition}; filename="${name}"`,
      // The built-in PDF viewer needs a CSP that does not forbid objects; only framing is limited here.
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Cache-Control": "private, no-store",
    })
    res.send(content)
  })

  /** Asks RechnungsAPI to check the stored document again. */
  router.post("/:id/revalidate", async (req, res) => {
    const record = find(req.params.id)
    const pdf = record.files.pdf ? await store.readFile(record.files.pdf) : null
    const xml = record.files.xml ? await store.readFile(record.files.xml) : null
    if (!pdf && !xml) throw new AppError(404, "not_found", "File not found.")

    const checked = pdf ? await einvoice.validatePdf(pdf) : await einvoice.validateXml(String(xml?.toString("utf8")))
    const result = { ...record.result, valid: checked.valid, issues: checked.issues, message: checked.message, checkedAt: new Date().toISOString() }
    const updated = await store.update("invoices", record.id, { result, status: checked.valid ? "valid" : "invalid" })
    res.json(view(updated))
  })

  router.delete("/:id", async (req, res) => {
    const removed = await store.remove("invoices", req.params.id)
    if (!removed) throw new AppError(404, "not_found", "Invoice not found.")
    await Promise.all(Object.values(removed.files).map((id) => store.removeFile(String(id))))
    res.status(204).end()
  })

  return router
}
