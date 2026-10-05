import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sampleDraft, startDemo } from "./helpers.js"

/** @type {Awaited<ReturnType<typeof startDemo>>} */
let demo
let customerId

beforeAll(async () => {
  demo = await startDemo()
  customerId = demo.store.list("customers")[0].id
})

afterAll(() => demo.close())

beforeEach(async () => {
  // Every test starts from the sample data with no invoices and no recorded API calls.
  await demo.store.reset()
  customerId = demo.store.list("customers")[0].id
  demo.gateway.calls.length = 0
  demo.gateway.state.fail = null
})

const lastCall = () => demo.gateway.calls.at(-1)

describe("creating a ZUGFeRD invoice", () => {
  it("builds the invoice, calls the API with the token and stores the result", async () => {
    const { status, body } = await demo.post("/api/invoices", sampleDraft(customerId))

    expect(status).toBe(201)
    expect(body).toMatchObject({
      number: "RE-2026-0001",
      format: "zugferd",
      status: "valid",
      totals: { net: 2068.7, vat: 385.97, gross: 2454.67 },
      result: { valid: true, issues: [] },
      files: { pdf: true, xml: true },
    })

    const call = lastCall()
    expect(call.path).toBe("/api/v1/zugferd/createZugferdFromJson")
    expect(call.token).toBe("test-token")
    expect(Buffer.from(call.body.invoicePdf64, "base64").subarray(0, 5).toString()).toBe("%PDF-")
    expect(call.body.invoice).toEqual(body.payload)
  })

  it("sends dates the way the API wants them", async () => {
    const { body } = await demo.post("/api/invoices", sampleDraft(customerId))
    expect(body.payload).toMatchObject({
      invoiceIssueDate: "2026-10-05T00:00:00",
      paymentDueDate: "2026-10-19",
      deliveryInformation: { actualDeliveryDate: "2026-09-30T00:00:00" },
    })
  })

  it("serves the ZUGFeRD PDF and the embedded XML", async () => {
    const { body } = await demo.post("/api/invoices", sampleDraft(customerId))

    const pdf = await demo.get(`/api/invoices/${body.id}/files/pdf`)
    expect(pdf.headers.get("content-type")).toBe("application/pdf")
    expect(pdf.headers.get("content-disposition")).toBe('inline; filename="RE-2026-0001.pdf"')
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-")

    const download = await demo.get(`/api/invoices/${body.id}/files/pdf?download=1`)
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="RE-2026-0001.pdf"')

    const xml = await demo.get(`/api/invoices/${body.id}/files/xml`)
    expect(xml.headers.get("content-type")).toContain("application/xml")
    expect(xml.body.toString()).toContain("<ram:ID>RE-2026-0001</ram:ID>")
  })
})

describe("creating an XRechnung", () => {
  it("sends no PDF and stores only the XML", async () => {
    const { status, body } = await demo.post("/api/invoices", sampleDraft(customerId, { format: "xrechnung" }))

    expect(status).toBe(201)
    expect(body).toMatchObject({ format: "xrechnung", status: "valid", files: { pdf: false, xml: true } })
    expect(lastCall().path).toBe("/api/v1/zugferd/createXinvoiceFromJson")
    expect(lastCall().body.invoicePdf64).toBeUndefined()
    expect((await demo.get(`/api/invoices/${body.id}/files/pdf`)).status).toBe(404)
  })

  it("needs a buyer reference", async () => {
    const draft = sampleDraft(customerId, { format: "xrechnung", buyerReference: "" })
    const { status, body } = await demo.post("/api/invoices", draft)
    expect(status).toBe(422)
    expect(body.fields).toEqual({ buyerReference: "required" })
  })
})

describe("the arithmetic is always right", () => {
  it("passes the EN 16931 rules of the mock gateway for 40 random invoices", async () => {
    let seed = 42
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let run = 0; run < 40; run += 1) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => ({
        description: `Position ${index + 1}`,
        quantity: Math.round(random() * 9999) / 100 + 0.01,
        unit: "C62",
        unitPrice: Math.round(random() * 99999) / 100,
        vatRate: [19, 7, 0][Math.floor(random() * 3)],
      }))
      const draft = sampleDraft(customerId, {
        number: `T-${run}`,
        format: run % 2 ? "xrechnung" : "zugferd",
        exemptionReason: "Steuerfrei",
        lines,
      })
      const { status, body } = await demo.post("/api/invoices", draft)
      expect(status).toBe(201)
      expect(body.result.issues, `run ${run}: ${JSON.stringify(lines)}`).toEqual([])
      expect(body.status).toBe("valid")
    }
  })

  it("sends a tax-exempt line as category E with the exemption reason", async () => {
    const draft = sampleDraft(customerId, {
      exemptionReason: "Steuerfreie Ausfuhrlieferung",
      lines: [{ description: "Export", quantity: 1, unit: "C62", unitPrice: 500, vatRate: 0 }],
    })
    const { body } = await demo.post("/api/invoices", draft)
    expect(body.status).toBe("valid")
    expect(body.payload.vatBreakdown).toEqual([
      { vatCategoryCode: "E", vatCategoryRate: 0, vatCategoryTaxableAmount: 500, vatCategoryTaxAmount: 0, vatExemptionReasonText: "Steuerfreie Ausfuhrlieferung" },
    ])
  })
})

describe("invoice numbers", () => {
  it("count up without gaps", async () => {
    const numbers = []
    for (let run = 0; run < 3; run += 1) numbers.push((await demo.post("/api/invoices", sampleDraft(customerId))).body.number)
    expect(numbers).toEqual(["RE-2026-0001", "RE-2026-0002", "RE-2026-0003"])
  })

  it("do not advance for a number you typed yourself, and cannot be used twice", async () => {
    const first = await demo.post("/api/invoices", sampleDraft(customerId, { number: "INDIVIDUELL-1" }))
    expect(first.body.number).toBe("INDIVIDUELL-1")
    const duplicate = await demo.post("/api/invoices", sampleDraft(customerId, { number: "INDIVIDUELL-1" }))
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toBe("number_taken")
    expect((await demo.post("/api/invoices", sampleDraft(customerId))).body.number).toBe("RE-2026-0001")
  })

  it("are not used up when the API call fails", async () => {
    demo.gateway.state.fail = { status: 500 }
    const failed = await demo.post("/api/invoices", sampleDraft(customerId))
    expect(failed.status).toBe(502)
    expect(failed.body.error).toBe("upstream")

    demo.gateway.state.fail = null
    const created = await demo.post("/api/invoices", sampleDraft(customerId))
    expect(created.body.number).toBe("RE-2026-0001")
    expect(demo.store.list("invoices")).toHaveLength(1)
  })

  it("stay unique when several invoices are created at the same moment", async () => {
    const answers = await Promise.all(Array.from({ length: 5 }, () => demo.post("/api/invoices", sampleDraft(customerId))))
    expect(answers.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201])
    expect(new Set(answers.map((answer) => answer.body.number)).size).toBe(5)
  })
})

describe("checking the form", () => {
  it("answers 422 with one code per field", async () => {
    const draft = sampleDraft(customerId, {
      issueDate: "2026-02-30",
      dueDate: "",
      lines: [{ description: "", quantity: -1, unitPrice: "abc", vatRate: 21 }],
    })
    const { status, body } = await demo.post("/api/invoices", draft)
    expect(status).toBe(422)
    expect(body.error).toBe("validation")
    expect(body.fields).toEqual({
      issueDate: "invalid",
      dueDate: "required",
      "lines.0.description": "required",
      "lines.0.quantity": "invalid",
      "lines.0.unitPrice": "invalid",
      "lines.0.vatRate": "invalid",
    })
    expect(demo.gateway.calls).toHaveLength(0)
  })

  it.each([
    ["no lines", { lines: [] }, { lines: "required" }],
    ["a due date before the invoice date", { dueDate: "2026-10-01" }, { dueDate: "date_order" }],
    ["an unknown customer", { customerId: "cus_nope" }, { customerId: "unknown" }],
    ["a missing customer", { customerId: "" }, { customerId: "required" }],
    ["too many decimals", { lines: [{ description: "x", quantity: 1.00001, unit: "C62", unitPrice: 1, vatRate: 19 }] }, { "lines.0.quantity": "decimals" }],
    ["a 0 % line without a reason", { lines: [{ description: "x", quantity: 1, unit: "C62", unitPrice: 1, vatRate: 0 }] }, { exemptionReason: "required" }],
    ["an invalid number", { number: "bad<number>" }, { number: "invalid" }],
  ])("rejects %s", async (_name, patch, fields) => {
    const { status, body } = await demo.post("/api/invoices", sampleDraft(customerId, patch))
    expect(status).toBe(422)
    expect(body.fields).toEqual(fields)
  })

  it("refuses a request that is not JSON", async () => {
    const response = await fetch(`${demo.url}/api/invoices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("invalid_json")
  })

  it("asks for the company profile to be completed first", async () => {
    demo.store.data.settings.company.vatId = ""
    const { status, body } = await demo.post("/api/invoices", sampleDraft(customerId))
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: "seller_incomplete", missing: ["vatId"] })
  })

  it("asks for the customer to be completed first", async () => {
    demo.store.list("customers")[0].email = ""
    const { status, body } = await demo.post("/api/invoices", sampleDraft(customerId))
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: "customer_incomplete", missing: ["email"], customerId })
  })
})

describe("when the API says no", () => {
  it.each([
    [401, "unauthorized", 502],
    [402, "no_access", 402],
    [429, "rate_limited", 429],
    [500, "upstream", 502],
  ])("explains a %i answer as %s", async (upstream, code, httpStatus) => {
    demo.gateway.state.fail = { status: upstream, body: { message: "nope" } }
    const { status, body } = await demo.post("/api/invoices", sampleDraft(customerId))
    expect(status).toBe(httpStatus)
    expect(body.error).toBe(code)
    expect(JSON.stringify(body)).not.toContain("test-token")
  })

  it("explains a rejected token", async () => {
    const rejected = await startDemo({ token: "invalid-token" })
    try {
      const id = rejected.store.list("customers")[0].id
      const { status, body } = await rejected.post("/api/invoices", sampleDraft(id))
      expect([status, body.error]).toEqual([502, "unauthorized"])
    } finally {
      await rejected.close()
    }
  })

  it("explains a missing token without calling anything", async () => {
    const without = await startDemo({ token: "" })
    try {
      const id = without.store.list("customers")[0].id
      const { status, body } = await without.post("/api/invoices", sampleDraft(id))
      expect([status, body.error]).toEqual([503, "no_token"])
      expect(without.gateway.calls).toHaveLength(0)
      expect((await without.get("/api/config")).body.tokenConfigured).toBe(false)
    } finally {
      await without.close()
    }
  })

  it("explains an unreachable gateway", async () => {
    const closed = await startDemo()
    const id = closed.store.list("customers")[0].id
    await closed.gateway.close()
    try {
      const { status, body } = await closed.post("/api/invoices", sampleDraft(id))
      expect([status, body.error]).toEqual([502, "unreachable"])
    } finally {
      await closed.close().catch(() => {})
    }
  })
})

describe("sending the invoice by e-mail in the same call", () => {
  const transport = { enabled: true, sender: "rechnung@example.com", senderName: "Beispiel", receiver: "a@example.org, b@example.org", subject: "Rechnung {invoicenumber}", message: "<p>Hallo</p>" }

  it("passes a transport object to the API and remembers who got it", async () => {
    const { status, body } = await demo.post("/api/invoices", sampleDraft(customerId, { transport }))
    expect(status).toBe(201)
    expect(body.result.emailQueued).toBe(true)
    expect(body.sentTo).toBe("a@example.org, b@example.org")
    expect(lastCall().body.transport).toMatchObject({ type: "email", useTransport: true, sender: "rechnung@example.com", receiver: "a@example.org, b@example.org" })
    expect(JSON.stringify(body)).not.toContain("<p>Hallo</p>")
  })

  it("sends nothing when it is switched off", async () => {
    await demo.post("/api/invoices", sampleDraft(customerId, { transport: { ...transport, enabled: false } }))
    expect(lastCall().body.transport).toBeUndefined()
  })

  it("checks the addresses", async () => {
    const { status, body } = await demo.post("/api/invoices", sampleDraft(customerId, { transport: { ...transport, receiver: "not-an-address" } }))
    expect(status).toBe(422)
    expect(body.fields).toEqual({ "transport.receiver": "invalid" })
  })
})

describe("previews cost no API calls", () => {
  it("returns the API payload and the totals", async () => {
    const { status, body } = await demo.post("/api/invoices/preview", sampleDraft(customerId))
    expect(status).toBe(200)
    expect(body.number).toBe("RE-2026-0001")
    expect(body.totals.gross).toBe(2454.67)
    expect(body.payload.invoiceNumber).toBe("RE-2026-0001")
    expect(demo.gateway.calls).toHaveLength(0)
    expect(demo.store.list("invoices")).toHaveLength(0)
  })

  it("renders the invoice PDF", async () => {
    const { status, body, headers } = await demo.post("/api/invoices/preview-pdf", sampleDraft(customerId, { language: "en" }))
    expect(status).toBe(200)
    expect(headers.get("content-type")).toBe("application/pdf")
    expect(body.subarray(0, 5).toString()).toBe("%PDF-")
    expect(demo.gateway.calls).toHaveLength(0)
  })
})

describe("looking at invoices", () => {
  it("lists, filters and searches", async () => {
    await demo.post("/api/invoices", sampleDraft(customerId))
    await demo.post("/api/invoices", sampleDraft(customerId, { format: "xrechnung" }))
    const other = demo.store.list("customers")[2].id
    await demo.post("/api/invoices", sampleDraft(other))

    const all = (await demo.get("/api/invoices")).body
    expect(all).toHaveLength(3)
    expect(all[0]).toMatchObject({ number: "RE-2026-0003", status: "valid", gross: 2454.67 })
    expect((await demo.get("/api/invoices?format=xrechnung")).body).toHaveLength(1)
    expect((await demo.get("/api/invoices?q=bäckerei")).body).toHaveLength(1)
    expect((await demo.get("/api/invoices?status=invalid")).body).toHaveLength(0)
    expect((await demo.get("/api/invoices/inv_missing")).status).toBe(404)
  })

  it("checks the stored document again", async () => {
    const { body } = await demo.post("/api/invoices", sampleDraft(customerId))
    demo.gateway.calls.length = 0
    const checked = await demo.post(`/api/invoices/${body.id}/revalidate`)
    expect(checked.status).toBe(200)
    expect(checked.body).toMatchObject({ status: "valid", result: { valid: true } })
    expect(checked.body.result.checkedAt).toBeTruthy()
    expect(lastCall().path).toBe("/api/v1/zugferd/validateZugferdPdf")
  })

  it("deletes an invoice and its files", async () => {
    const { body } = await demo.post("/api/invoices", sampleDraft(customerId))
    const fileId = demo.store.find("invoices", body.id).files.pdf
    expect(await demo.store.readFile(fileId)).not.toBeNull()
    expect((await demo.del(`/api/invoices/${body.id}`)).status).toBe(204)
    expect(await demo.store.readFile(fileId)).toBeNull()
    expect((await demo.get(`/api/invoices/${body.id}`)).status).toBe(404)
    expect((await demo.del(`/api/invoices/${body.id}`)).status).toBe(404)
  })
})

describe("the activity log and the numbers", () => {
  it("records each API call without any content", async () => {
    await demo.post("/api/invoices", sampleDraft(customerId, { number: "GEHEIM-4711" }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    const { body } = await demo.get("/api/activity")
    expect(body[0]).toMatchObject({ name: "createZugferdFromJson", ok: true })
    expect(typeof body[0].ms).toBe("number")
    const text = JSON.stringify(body)
    expect(text).not.toContain("GEHEIM-4711")
    expect(text).not.toContain("test-token")
  })

  it("counts invoices for the dashboard", async () => {
    await demo.post("/api/invoices", sampleDraft(customerId))
    await demo.post("/api/invoices", sampleDraft(customerId, { format: "xrechnung" }))
    const { body } = await demo.get("/api/stats")
    expect(body).toMatchObject({ invoices: 2, valid: 2, invalid: 0, volume: 4909.34, zugferd: 1, xrechnung: 1 })
  })
})
