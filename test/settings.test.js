import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { detectKind, readUpload } from "../server/domain/files.js"
import { missingBuyerFields, missingSellerFields, parseCompany, parseCustomer, parseDefaults } from "../server/domain/validate.js"
import { defaultCustomers, defaultSettings } from "../server/seed.js"
import { TINY_PDF, base64, startDemo } from "./helpers.js"

/** @type {Awaited<ReturnType<typeof startDemo>>} */
let demo
beforeAll(async () => {
  demo = await startDemo()
})
afterAll(() => demo.close())
beforeEach(() => demo.store.reset())

describe("settings", () => {
  it("returns the company and the defaults", async () => {
    const { status, body } = await demo.get("/api/settings")
    expect(status).toBe(200)
    expect(body.company.name).toBe("Beispiel Software GmbH")
    expect(body.defaults).toEqual({ paymentDays: 14, vatRate: 19, language: "de", format: "zugferd" })
  })

  it("saves changes, cleans the input up and keeps them", async () => {
    const settings = (await demo.get("/api/settings")).body
    settings.company.name = "  Neue Firma  "
    settings.company.iban = "de89 3704 0044 0532 0130 00"
    settings.company.vatId = " de 111 222 333 "
    settings.defaults.paymentDays = "30"
    const { status, body } = await demo.put("/api/settings", settings)
    expect(status).toBe(200)
    expect(body.company).toMatchObject({ name: "Neue Firma", iban: "DE89370400440532013000", vatId: "DE111222333" })
    expect(body.defaults.paymentDays).toBe(30)
    expect((await demo.get("/api/settings")).body.company.name).toBe("Neue Firma")
  })

  it("rejects wrong data field by field", async () => {
    const settings = (await demo.get("/api/settings")).body
    Object.assign(settings.company, { name: "", iban: "DE00", vatId: "123", email: "kein-mail", country: "XX", bic: "x" })
    const { status, body } = await demo.put("/api/settings", settings)
    expect(status).toBe(422)
    expect(body.fields).toEqual({ name: "required", country: "invalid", vatId: "invalid", email: "invalid", iban: "invalid", bic: "invalid" })
  })

  it("rejects wrong defaults", async () => {
    const settings = (await demo.get("/api/settings")).body
    Object.assign(settings.defaults, { paymentDays: -1, vatRate: 21, language: "fr", format: "pdf" })
    const { body } = await demo.put("/api/settings", settings)
    expect(body.fields).toEqual({ paymentDays: "invalid", vatRate: "invalid", language: "invalid", format: "invalid" })
  })
})

describe("customers", () => {
  const customer = { name: "Neue Kundin AG", street: "Weg 1", zip: "10115", city: "Berlin", country: "de", vatId: "de 123456789", email: "a@example.com", buyerReference: "ABC" }

  it("lists, creates, changes and deletes", async () => {
    expect((await demo.get("/api/customers")).body).toHaveLength(3)

    const created = await demo.post("/api/customers", customer)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ id: expect.stringMatching(/^cus_/), name: "Neue Kundin AG", country: "DE", vatId: "DE123456789" })
    expect((await demo.get("/api/customers")).body).toHaveLength(4)

    const changed = await demo.put(`/api/customers/${created.body.id}`, { ...customer, city: "Potsdam" })
    expect(changed.body.city).toBe("Potsdam")
    expect(changed.body.id).toBe(created.body.id)

    expect((await demo.del(`/api/customers/${created.body.id}`)).status).toBe(204)
    expect((await demo.get("/api/customers")).body).toHaveLength(3)
    expect((await demo.put(`/api/customers/${created.body.id}`, customer)).status).toBe(404)
    expect((await demo.del(`/api/customers/${created.body.id}`)).status).toBe(404)
  })

  it("checks the data", async () => {
    const { status, body } = await demo.post("/api/customers", { ...customer, name: "", email: "x", zip: "" })
    expect(status).toBe(422)
    expect(body.fields).toEqual({ name: "required", zip: "required", email: "invalid" })
  })

  it("leaves the invoices of a deleted customer as they were", async () => {
    const [first] = demo.store.list("customers")
    const draft = { customerId: first.id, issueDate: "2026-10-05", dueDate: "2026-10-19", format: "zugferd", language: "de", lines: [{ description: "x", quantity: 1, unit: "C62", unitPrice: 10, vatRate: 19 }] }
    const invoice = (await demo.post("/api/invoices", draft)).body
    await demo.del(`/api/customers/${first.id}`)
    const stored = (await demo.get(`/api/invoices/${invoice.id}`)).body
    expect(stored.buyer.name).toBe(first.name)
  })
})

describe("parsers", () => {
  it("accept the sample data", () => {
    expect(() => parseCompany(defaultSettings().company)).not.toThrow()
    expect(() => parseDefaults(defaultSettings().defaults)).not.toThrow()
    for (const customer of defaultCustomers()) expect(() => parseCustomer(customer)).not.toThrow()
  })

  it("refuse things that are not objects", () => {
    for (const input of [null, undefined, "x", 5, []]) {
      expect(() => parseCompany(input)).toThrow()
      expect(() => parseCustomer(input)).toThrow()
      expect(() => parseDefaults(input)).toThrow()
    }
  })

  it("tell what is missing", () => {
    expect(missingSellerFields({ ...defaultSettings().company, vatId: " ", iban: "" })).toEqual(["vatId", "iban"])
    expect(missingBuyerFields({ name: "x" })).toEqual(["street", "zip", "city", "country", "email"])
    expect(missingBuyerFields(defaultCustomers()[2])).toEqual([])
  })
})

describe("recognising files", () => {
  it("knows PDF, PNG, JPEG, TIFF and XML by their first bytes", () => {
    expect(detectKind(TINY_PDF)).toBe("pdf")
    expect(detectKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png")
    expect(detectKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpeg")
    expect(detectKind(Buffer.from("II*\0....", "latin1"))).toBe("tiff")
    expect(detectKind(Buffer.from("MM\0*....", "latin1"))).toBe("tiff")
    expect(detectKind(Buffer.from("<?xml version='1.0'?><a/>"))).toBe("xml")
    expect(detectKind(Buffer.from("﻿  \n<a/>"))).toBe("xml")
  })

  it("does not guess when it cannot tell", () => {
    expect(detectKind(Buffer.from("hello"))).toBeNull()
    expect(detectKind(Buffer.from([0, 1, 2, 3]))).toBeNull()
    expect(detectKind(Buffer.alloc(0))).toBeNull()
  })

  it("rejects an upload by kind", () => {
    expect(() => readUpload({ fileBase64: base64(TINY_PDF) }, ["xml"])).toThrow(/not supported/)
    expect(readUpload({ fileBase64: base64(TINY_PDF), fileName: "a.pdf" }, ["pdf"])).toMatchObject({ kind: "pdf", fileName: "a.pdf" })
  })
})
