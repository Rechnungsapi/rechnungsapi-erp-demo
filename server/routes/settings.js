import express from "express"
import { parseCompany, parseDefaults } from "../domain/validate.js"

/** Your company profile and the defaults for new invoices. @param {import("../app.js").Context} ctx */
export function settingsRouter({ store }) {
  const router = express.Router()

  router.get("/", (req, res) => {
    res.json(store.data.settings)
  })

  router.put("/", async (req, res) => {
    const company = parseCompany(req.body?.company)
    const defaults = parseDefaults(req.body?.defaults)
    res.json(await store.saveSettings({ company, defaults }))
  })

  return router
}
