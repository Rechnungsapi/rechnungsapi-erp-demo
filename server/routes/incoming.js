import express from "express"
import { readUpload } from "../domain/files.js"
import { AppError } from "../http-errors.js"
import { newId } from "../ids.js"

const KEEP = 100

/** Which kinds of file each action accepts. */
const ACTIONS = {
  /** Check an XRechnung XML or a ZUGFeRD PDF. */
  validate: ["xml", "pdf"],
  /** Read the structured data that is embedded in a ZUGFeRD PDF. */
  extract: ["pdf"],
  /** Read any invoice (PDF, scan, photo) with AI. */
  read: ["pdf", "png", "jpeg", "tiff"],
  /** Turn any invoice PDF or scan into a ZUGFeRD PDF. */
  convert: ["pdf", "png", "jpeg", "tiff"],
}

/** Documents you receive: check them, read them, convert them. @param {import("../app.js").Context} ctx */
export function incomingRouter({ store, einvoice }) {
  const router = express.Router()

  const view = ({ fileId, ...record }) => ({ ...record, hasFile: Boolean(fileId) })

  router.get("/", (req, res) => {
    res.json(store.list("incoming").map(view))
  })

  router.post("/", async (req, res) => {
    const action = String(req.body?.action ?? "")
    if (!Object.hasOwn(ACTIONS, action)) {
      throw new AppError(422, "validation", "Unknown action.", { fields: { action: "invalid" } })
    }
    const { buffer, fileName, kind } = readUpload(req.body, /** @type {any} */ (ACTIONS)[action])

    let ok = true
    let data = {}
    let fileId
    if (action === "validate") {
      const checked = kind === "xml" ? await einvoice.validateXml(buffer.toString("utf8")) : await einvoice.validatePdf(buffer)
      ok = checked.valid
      data = { valid: checked.valid, issues: checked.issues, message: checked.message }
    } else if (action === "extract") {
      data = { invoice: (await einvoice.extract(buffer)).invoice }
    } else if (action === "read") {
      const read = await einvoice.read(buffer, { withLineItems: req.body?.withLineItems !== false })
      data = { confidence: read.confidence, invoice: read.invoice }
    } else {
      // A conversion that cannot be done is an answer, not a crash: it comes with a reason.
      const converted = await einvoice.convert(buffer, fileName)
      if (converted.ok) {
        fileId = await store.saveFile(converted.pdf, "pdf")
        data = { reference: converted.reference, fileName: converted.fileName }
      } else {
        ok = false
        data = { code: converted.code, message: converted.message, retryable: converted.retryable, reference: converted.reference, rules: converted.rules }
      }
    }

    const record = { id: newId("inc_"), action, fileName, kind, size: buffer.length, ok, data, fileId, createdAt: new Date().toISOString() }
    await store.insert("incoming", record)
    const dropped = await store.trim("incoming", KEEP)
    await Promise.all(dropped.filter((item) => item.fileId).map((item) => store.removeFile(item.fileId)))
    res.status(201).json(view(record))
  })

  router.get("/:id/file", async (req, res) => {
    const record = store.find("incoming", req.params.id)
    const content = record?.fileId ? await store.readFile(record.fileId) : null
    if (!record || !content) throw new AppError(404, "not_found", "File not found.")
    const name = `${String(record.data.fileName ?? record.fileName).replace(/[^\w.-]+/g, "_")}`.replace(/\.pdf$/i, "")
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="${name}.pdf"`,
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Cache-Control": "private, no-store",
    })
    res.send(content)
  })

  router.delete("/:id", async (req, res) => {
    const removed = await store.remove("incoming", req.params.id)
    if (!removed) throw new AppError(404, "not_found", "Not found.")
    if (removed.fileId) await store.removeFile(removed.fileId)
    res.status(204).end()
  })

  return router
}
