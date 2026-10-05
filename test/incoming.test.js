import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { TINY_PDF, base64, sampleDraft, startDemo } from "./helpers.js"

/** @type {Awaited<ReturnType<typeof startDemo>>} */
let demo

beforeAll(async () => {
  demo = await startDemo()
})
afterAll(() => demo.close())
beforeEach(async () => {
  await demo.store.reset()
  demo.gateway.calls.length = 0
  demo.gateway.state.fail = null
})

const upload = (action, content, fileName = "invoice.pdf", extra = {}) =>
  demo.post("/api/incoming", { action, fileName, fileBase64: base64(content), ...extra })

/** A real ZUGFeRD PDF as the mock gateway makes it. */
async function zugferdPdf() {
  const customerId = demo.store.list("customers")[0].id
  const { body } = await demo.post("/api/invoices", sampleDraft(customerId))
  demo.gateway.calls.length = 0
  return (await demo.get(`/api/invoices/${body.id}/files/pdf`)).body
}

const xml = (buyerReference = "<ram:BuyerReference>X</ram:BuyerReference>") =>
  `<?xml version="1.0"?><rsm:CrossIndustryInvoice>${buyerReference}<ram:GrandTotalAmount>1</ram:GrandTotalAmount></rsm:CrossIndustryInvoice>`

describe("validating a document you received", () => {
  it("accepts a valid XRechnung XML", async () => {
    const { status, body } = await upload("validate", Buffer.from(xml()), "rechnung.xml")
    expect(status).toBe(201)
    expect(body).toMatchObject({ action: "validate", kind: "xml", ok: true, data: { valid: true, issues: [] } })
    expect(demo.gateway.calls.at(-1).path).toBe("/api/v1/zugferd/validateXinvoiceXml")
  })

  it("shows what is wrong with an invalid XML, with the rule that was broken", async () => {
    const { body } = await upload("validate", Buffer.from(xml("")), "kaputt.xml")
    expect(body.ok).toBe(false)
    expect(body.data.issues).toEqual([
      expect.objectContaining({ rule: "BR-DE-15", severity: "error", message: expect.stringContaining("Buyer reference") }),
    ])
  })

  it("validates a ZUGFeRD PDF", async () => {
    const { body } = await upload("validate", await zugferdPdf(), "zugferd.pdf")
    expect(body).toMatchObject({ kind: "pdf", ok: true })
    expect(demo.gateway.calls.at(-1).path).toBe("/api/v1/zugferd/validateZugferdPdf")
  })

  it("says that a plain PDF is not a ZUGFeRD invoice", async () => {
    const { body } = await upload("validate", TINY_PDF, "plain.pdf")
    expect(body.ok).toBe(false)
    expect(body.data.issues[0].rule).toBe("ZUGFERD-XML-MISSING")
  })
})

describe("reading a document", () => {
  it("extracts the data embedded in a ZUGFeRD PDF", async () => {
    const { status, body } = await upload("extract", await zugferdPdf(), "zugferd.pdf")
    expect(status).toBe(201)
    expect(body.data.invoice).toMatchObject({ invoiceNumber: "RE-2026-0001", seller: { sellerName: "Beispiel Software GmbH" } })
  })

  it("reads any invoice with AI, with or without the line items", async () => {
    const withLines = (await upload("read", TINY_PDF)).body.data
    expect(withLines.confidence).toBe(96)
    expect(withLines.invoice.invoiceLine).toHaveLength(2)
    expect(demo.gateway.calls.at(-1).path).toBe("/createJSONFromAnalysedPdf")
    expect(demo.gateway.calls.at(-1).body.withLineItems).toBe(true)

    const headerOnly = (await upload("read", TINY_PDF, "x.pdf", { withLineItems: false })).body.data
    expect(headerOnly.invoice.invoiceLine).toBeUndefined()
    expect(demo.gateway.calls.at(-1).body.withLineItems).toBe(false)
  })

  it("accepts a photo", async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
    const { status, body } = await upload("read", jpeg, "foto.jpg")
    expect([status, body.kind]).toEqual([201, "jpeg"])
  })
})

describe("converting a PDF to ZUGFeRD", () => {
  it("returns the PDF and keeps it", async () => {
    const { status, body } = await upload("convert", TINY_PDF, "Rechnung 42.pdf")
    expect(status).toBe(201)
    expect(body).toMatchObject({ ok: true, hasFile: true, data: { reference: "ZAPI-MOCK-1", fileName: "Rechnung 42-zugferd.pdf" } })

    const file = await demo.get(`/api/incoming/${body.id}/file`)
    expect(file.headers.get("content-type")).toBe("application/pdf")
    expect(file.body.subarray(0, 5).toString()).toBe("%PDF-")
    expect(file.body.includes("%mock-zugferd:")).toBe(true)
  })

  it("reports a rejected token during a conversion as an error and keeps no history entry for it", async () => {
    const { status, body } = await upload("convert", TINY_PDF, "unauthorized.pdf")
    expect([status, body.error]).toEqual([502, "unauthorized"])
    expect(demo.store.list("incoming")).toHaveLength(0)
  })

  it("treats a refused conversion as an answer with a reason, not as an error", async () => {
    const { status, body } = await upload("convert", TINY_PDF, "unreadable.pdf")
    expect(status).toBe(201)
    expect(body).toMatchObject({ ok: false, hasFile: false, data: { code: "EXTRACTION_LOW_CONFIDENCE", reference: "ZAPI-MOCK-ERR" } })
  })
})

describe("uploads", () => {
  it("are recognised by their content, not by their name", async () => {
    const { status, body } = await upload("validate", Buffer.from(xml()), "looks-like-a.pdf")
    expect([status, body.kind]).toEqual([201, "xml"])
  })

  it("refuse files that are not supported for the action", async () => {
    const random = await upload("validate", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    expect([random.status, random.body.error]).toEqual([415, "unsupported_file"])
    const xmlForExtract = await upload("extract", Buffer.from(xml()))
    expect([xmlForExtract.status, xmlForExtract.body.error]).toEqual([415, "unsupported_file"])
    expect(demo.gateway.calls).toHaveLength(0)
  })

  it("refuse an empty or missing file and an unknown action", async () => {
    expect((await demo.post("/api/incoming", { action: "validate" })).body.fields).toEqual({ file: "required" })
    expect((await demo.post("/api/incoming", { action: "validate", fileBase64: "" })).status).toBe(422)
    expect((await upload("shred", TINY_PDF)).body.fields).toEqual({ action: "invalid" })
  })

  it("refuse files over the limit", async () => {
    const big = Buffer.concat([TINY_PDF, Buffer.alloc(11 * 1024 * 1024)])
    const { status, body } = await upload("validate", big)
    expect([status, body.error]).toEqual([413, "file_too_large"])
    expect(demo.gateway.calls).toHaveLength(0)
  })

  it("refuse a request body that is far too large", async () => {
    const huge = Buffer.concat([TINY_PDF, Buffer.alloc(13 * 1024 * 1024)])
    const { status, body } = await upload("validate", huge)
    expect([status, body.error]).toEqual([413, "payload_too_large"])
  })

  it("tolerate a data URL prefix and strip dangerous characters from the file name", async () => {
    const { status, body } = await demo.post("/api/incoming", {
      action: "validate",
      fileName: 'a"b\\c/d\u0001.pdf',
      fileBase64: `data:application/pdf;base64,${base64(TINY_PDF)}`,
    })
    expect(status).toBe(201)
    expect(body.fileName).toBe("a b c d .pdf")
  })
})

describe("the history", () => {
  it("lists the newest first, deletes with the produced file and keeps at most 100", async () => {
    const first = (await upload("convert", TINY_PDF, "one.pdf")).body
    const second = (await upload("validate", Buffer.from(xml()), "two.xml")).body
    expect((await demo.get("/api/incoming")).body.map((item) => item.id)).toEqual([second.id, first.id])

    const fileId = demo.store.find("incoming", first.id).fileId
    expect((await demo.del(`/api/incoming/${first.id}`)).status).toBe(204)
    expect(await demo.store.readFile(fileId)).toBeNull()
    expect((await demo.get(`/api/incoming/${first.id}/file`)).status).toBe(404)

    for (let run = 0; run < 101; run += 1) await demo.store.insert("incoming", { id: `inc_${run}`, action: "validate", fileName: "x", kind: "xml", size: 1, ok: true, data: {}, createdAt: "" })
    await upload("validate", Buffer.from(xml()), "last.xml")
    expect(demo.store.list("incoming")).toHaveLength(100)
  })

  it("does not store anything when the API call fails", async () => {
    demo.gateway.state.fail = { status: 500 }
    const { status } = await upload("validate", Buffer.from(xml()))
    expect(status).toBe(502)
    expect(demo.store.list("incoming")).toHaveLength(0)
  })
})
