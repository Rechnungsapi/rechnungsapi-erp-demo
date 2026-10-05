import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { newId } from "../server/ids.js"
import { Store } from "../server/store.js"

let dir
/** @type {Store} */
let store

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "erp-store-test-"))
  store = await new Store(dir).init()
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe("the store", () => {
  it("starts with the sample data and writes it to disk", async () => {
    expect(store.list("customers")).toHaveLength(3)
    expect(store.data.settings.company.name).toBe("Beispiel Software GmbH")
    expect(JSON.parse(await readFile(path.join(dir, "db.json"), "utf8")).customers).toHaveLength(3)
  })

  it("keeps what was saved when it is started again", async () => {
    await store.insert("invoices", { id: "inv_1", number: "RE-1" })
    await store.update("customers", store.list("customers")[0].id, { name: "Geändert" })
    const again = await new Store(dir).init()
    expect(again.list("invoices")).toEqual([{ id: "inv_1", number: "RE-1" }])
    expect(again.list("customers")[0].name).toBe("Geändert")
  })

  it("inserts newest first, updates, finds and removes", async () => {
    await store.insert("invoices", { id: "a" })
    await store.insert("invoices", { id: "b" })
    expect(store.list("invoices").map((item) => item.id)).toEqual(["b", "a"])
    expect(await store.update("invoices", "a", { x: 1 })).toEqual({ id: "a", x: 1 })
    expect(await store.update("invoices", "zzz", { x: 1 })).toBeUndefined()
    expect(store.find("invoices", "a")).toEqual({ id: "a", x: 1 })
    expect(await store.remove("invoices", "a")).toEqual({ id: "a", x: 1 })
    expect(await store.remove("invoices", "a")).toBeUndefined()
  })

  it("trims a collection and returns what it dropped", async () => {
    for (const id of ["1", "2", "3", "4"]) await store.insert("incoming", { id })
    expect((await store.trim("incoming", 2)).map((item) => item.id)).toEqual(["2", "1"])
    expect(store.list("incoming").map((item) => item.id)).toEqual(["4", "3"])
  })

  it("keeps only the latest 200 activity entries", async () => {
    for (let run = 0; run < 205; run += 1) await store.addActivity({ id: String(run) })
    expect(store.list("activity")).toHaveLength(200)
    expect(store.list("activity")[0].id).toBe("204")
  })

  it("never loses a write when many happen at once, and never leaves a half-written file", async () => {
    await Promise.all(Array.from({ length: 100 }, (_, index) => store.insert("invoices", { id: `inv_${index}` })))
    expect(store.list("invoices")).toHaveLength(100)
    expect(JSON.parse(await readFile(path.join(dir, "db.json"), "utf8")).invoices).toHaveLength(100)
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  it("keeps working after one write failed", async () => {
    await expect(store.mutate(() => { throw new Error("boom") })).rejects.toThrow("boom")
    await store.insert("invoices", { id: "after" })
    expect(store.find("invoices", "after")).toBeTruthy()
  })

  it("numbers invoices per year and only uses a number when told to", async () => {
    expect(store.peekInvoiceNumber(2026)).toBe("RE-2026-0001")
    expect(store.peekInvoiceNumber(2026)).toBe("RE-2026-0001")
    await store.useInvoiceNumber(2026)
    expect(store.peekInvoiceNumber(2026)).toBe("RE-2026-0002")
    expect(store.peekInvoiceNumber(2027)).toBe("RE-2027-0001")
  })

  it("resets to the sample data and removes the files", async () => {
    const file = await store.saveFile("<x/>", "xml")
    await store.insert("invoices", { id: "a" })
    await store.reset()
    expect(store.list("invoices")).toEqual([])
    expect(await store.readFile(file)).toBeNull()
    expect(store.list("customers")).toHaveLength(3)
  })
})

describe("stored files", () => {
  it("round-trip content and are named with a random id and the right extension", async () => {
    const pdf = await store.saveFile(Buffer.from("%PDF-1.4 hi"), "pdf")
    const xml = await store.saveFile("<a/>", "xml")
    expect(pdf).toMatch(/^[A-Za-z0-9_-]{12}\.pdf$/)
    expect(xml).toMatch(/^[A-Za-z0-9_-]{12}\.xml$/)
    expect((await store.readFile(pdf))?.toString()).toBe("%PDF-1.4 hi")
    expect((await store.readFile(xml))?.toString()).toBe("<a/>")
  })

  it("only opens ids it created itself", async () => {
    for (const id of ["../db.json", "..\\db.json", "/etc/passwd", "db.json", "abcdefgh.exe", "abc.pdf", "a".repeat(41) + ".pdf", "abcdefgh.pdf/../x"]) {
      expect(await store.readFile(id), id).toBeNull()
    }
    await store.removeFile("../db.json")
    expect(await readFile(path.join(dir, "db.json"), "utf8")).toContain("customers")
  })

  it("makes ids that are unique and URL safe", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId("x_")))
    expect(ids.size).toBe(5000)
    expect([...ids].every((id) => /^x_[A-Za-z0-9_-]{12}$/.test(id))).toBe(true)
  })
})
