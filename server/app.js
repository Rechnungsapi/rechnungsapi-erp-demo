import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import { errorHandler } from "./http-errors.js"
import { customersRouter } from "./routes/customers.js"
import { incomingRouter } from "./routes/incoming.js"
import { invoicesRouter } from "./routes/invoices.js"
import { miscRouter } from "./routes/misc.js"
import { settingsRouter } from "./routes/settings.js"
import { hostGuard, securityHeaders } from "./security.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * @typedef {Object} Context
 * @property {import("./config.js").Config} config
 * @property {import("./store.js").Store} store
 * @property {ReturnType<typeof import("./einvoice.js").createEInvoice>} einvoice
 * @property {string} version
 */

/** Builds the Express app. It serves the API under /api and the UI from /public. @param {Context} ctx */
export function createApp(ctx) {
  const app = express()
  app.disable("x-powered-by")

  app.use(securityHeaders)
  app.use(hostGuard({ allowedHosts: ctx.config.allowedHosts }))
  // Invoices travel as base64 inside JSON. The API caps the whole request at 16 MB.
  app.use(express.json({ limit: "16mb" }))

  const api = express.Router()
  api.use(miscRouter(ctx))
  api.use("/settings", settingsRouter(ctx))
  api.use("/customers", customersRouter(ctx))
  api.use("/invoices", invoicesRouter(ctx))
  api.use("/incoming", incomingRouter(ctx))
  api.use((req, res) => res.status(404).json({ error: "not_found", message: "Unknown API route." }))
  app.use("/api", api)

  // The browser imports the money and date helpers from the same files the server uses.
  app.use("/shared", express.static(path.join(root, "shared"), { index: false, dotfiles: "ignore" }))
  app.use(express.static(path.join(root, "public"), { index: "index.html", dotfiles: "ignore" }))

  app.use(errorHandler)
  return app
}
