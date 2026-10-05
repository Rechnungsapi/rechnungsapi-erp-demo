import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { EInvoiceError, createEInvoice, issuesOf } from "../server/einvoice.js"
import { TINY_PDF } from "./helpers.js"
import { startMockGateway } from "./mock-gateway.js"

/** @type {Awaited<ReturnType<typeof startMockGateway>>} */
let gateway
const service = (overrides = {}) =>
  createEInvoice({ token: "test-token", baseUrl: gateway.url, v2BaseUrl: gateway.url, ...overrides })

beforeAll(async () => {
  gateway = await startMockGateway()
})
afterAll(() => gateway.close())

describe("issuesOf", () => {
  it("maps every shape the API uses to one", () => {
    const issues = issuesOf(
      [{ id: "BR-CO-25", type: "fatal", message: "m1", location: "/rsm", schemaFile: "EN16931-CII-validation" }],
      [{ BusinessTerm: "BT-31", message: "m2" }],
      [{ businessTerm: "BT-9", errormessage: "m3", businessTermDescription: "Payment due date" }],
      [{ code: "X", severity: "warning", message: "m4" }, { id: "Y", type: "info", message: "m5" }],
    )
    expect(issues).toEqual([
      { rule: "BR-CO-25", severity: "error", message: "m1", location: "/rsm", source: "EN16931-CII-validation" },
      { rule: "BT-31", severity: "error", message: "m2", location: undefined, source: undefined },
      { rule: "BT-9", severity: "error", message: "m3", location: undefined, source: undefined },
      { rule: "X", severity: "warning", message: "m4", location: undefined, source: undefined },
      { rule: "Y", severity: "info", message: "m5", location: undefined, source: undefined },
    ])
  })

  it("removes duplicates, which the ZUGFeRD endpoint reports in two lists", () => {
    const item = { id: "BR-CO-25", type: "fatal", message: "same", location: "/x" }
    expect(issuesOf([item], [{ ...item }])).toHaveLength(1)
  })

  it("copes with missing lists and odd values", () => {
    expect(issuesOf(undefined, null, "oops", [])).toEqual([])
    expect(issuesOf([{}])).toEqual([{ rule: "", severity: "error", message: "", location: undefined, source: undefined }])
  })
})

describe("the e-invoice service", () => {
  it("reports whether a token is configured", () => {
    expect(service().configured).toBe(true)
    expect(createEInvoice({ token: "" }).configured).toBe(false)
  })

  it("fails with no_token before calling anything", async () => {
    const before = gateway.calls.length
    await expect(createEInvoice({ token: "", baseUrl: gateway.url }).validateXml("<x/>")).rejects.toMatchObject({ name: "EInvoiceError", code: "no_token" })
    expect(gateway.calls).toHaveLength(before)
  })

  it("explains an invoice with missing mandatory data, with the business terms", async () => {
    const failure = await service().createXRechnung({ invoiceNumber: "X" }).catch((error) => error)
    expect(failure).toBeInstanceOf(EInvoiceError)
    expect(failure.code).toBe("missing_fields")
    expect(failure.details.missing.map((item) => item.rule)).toEqual(expect.arrayContaining(["BT-2", "BT-27", "BT-31"]))
    expect(failure.details.missing[0].message).toBeTruthy()
  })

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [402, "no_access"],
    [409, "conflict"],
    [422, "bad_input"],
    [429, "rate_limited"],
    [500, "upstream"],
    [503, "upstream"],
  ])("maps HTTP %i to %s", async (status, code) => {
    gateway.state.fail = { status, body: { message: "nope" } }
    try {
      await expect(service().validateXml("<x/>")).rejects.toMatchObject({ code })
    } finally {
      gateway.state.fail = null
    }
  })

  it("maps a refused connection to unreachable", async () => {
    const dead = await startMockGateway()
    const url = dead.url
    await dead.close()
    await expect(service({ baseUrl: url, v2BaseUrl: url }).validateXml("<x/>")).rejects.toMatchObject({ code: "unreachable" })
  })

  it("maps a timeout", async () => {
    const slow = () => Promise.reject(Object.assign(new Error("took too long"), { name: "TimeoutError" }))
    await expect(service({ fetch: slow }).validateXml("<x/>")).rejects.toMatchObject({ code: "timeout" })
  })

  it("tells the caller about every call, with its duration and outcome", async () => {
    const calls = []
    const watched = service({ onCall: (call) => calls.push(call) })
    await watched.validateXml("<x/>")
    gateway.state.fail = { status: 500 }
    await watched.validateXml("<x/>").catch(() => {})
    gateway.state.fail = null
    expect(calls).toEqual([
      { name: "validateXRechnungXml", ok: true, ms: expect.any(Number) },
      { name: "validateXRechnungXml", ok: false, ms: expect.any(Number), code: "upstream" },
    ])
  })

  it("sends the transport options of an e-mail delivery with type and useTransport", async () => {
    gateway.calls.length = 0
    const invoice = { invoiceNumber: "1", invoiceIssueDate: "2026-01-01T00:00:00", seller: { sellerName: "S", sellerVatIdentifier: "DE1", sellerPostalAddress: { sellerCity: "C", sellerCountryCode: "DE" }, sellerContact: { sellerContactPoint: "P", sellerContactTelephoneNumber: "1", sellerContactEmailAddress: "a@example.com" } }, buyer: { buyerName: "B", buyerPostalAddress: { buyerCity: "C" } }, invoiceLine: [{}] }
    await service().createXRechnung(invoice, { sender: "a@example.com", receiver: "b@example.org", subject: "s", message: "m" }).catch(() => {})
    expect(gateway.calls.at(-1).body.transport).toEqual({ type: "email", useTransport: true, sender: "a@example.com", receiver: "b@example.org", subject: "s", message: "m" })
  })

  it("keeps a refused conversion apart from a crash", async () => {
    const refused = await service().convert(TINY_PDF, "unreadable.pdf")
    expect(refused).toMatchObject({ ok: false, status: 422, code: "EXTRACTION_LOW_CONFIDENCE", retryable: false })
    const done = await service().convert(TINY_PDF, "fine.pdf")
    expect(done).toMatchObject({ ok: true, fileName: "fine-zugferd.pdf", reference: "ZAPI-MOCK-1" })
    expect(done.pdf.subarray(0, 5).toString()).toBe("%PDF-")
  })
})
