import express from "express"
import { AppError } from "../http-errors.js"
import { newId } from "../ids.js"
import { parseCustomer } from "../domain/validate.js"

/** Your customers, the buyers on the invoices. @param {import("../app.js").Context} ctx */
export function customersRouter({ store }) {
  const router = express.Router()

  router.get("/", (req, res) => {
    res.json(store.list("customers"))
  })

  router.post("/", async (req, res) => {
    const customer = { id: newId("cus_"), ...parseCustomer(req.body) }
    await store.insert("customers", customer)
    res.status(201).json(customer)
  })

  router.put("/:id", async (req, res) => {
    const updated = await store.update("customers", req.params.id, parseCustomer(req.body))
    if (!updated) throw new AppError(404, "not_found", "Customer not found.")
    res.json(updated)
  })

  // Invoices keep their own copy of the buyer, so deleting a customer never changes an invoice.
  router.delete("/:id", async (req, res) => {
    const removed = await store.remove("customers", req.params.id)
    if (!removed) throw new AppError(404, "not_found", "Customer not found.")
    res.status(204).end()
  })

  return router
}
