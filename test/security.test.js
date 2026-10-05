import http from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sampleDraft, startDemo } from "./helpers.js"

/** @type {Awaited<ReturnType<typeof startDemo>>} */
let demo

beforeAll(async () => {
  demo = await startDemo()
})
afterAll(() => demo.close())

/** A raw request, because fetch does not let a test choose the Host header. */
function raw(path, { method = "GET", headers = {}, body } = {}) {
  const url = new URL(demo.url)
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path, method, headers }, (res) => {
      const chunks = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }))
    })
    req.on("error", reject)
    req.end(body)
  })
}

describe("host and origin checks", () => {
  it("answers only to localhost host names, which stops DNS rebinding", async () => {
    const evil = await raw("/api/config", { headers: { Host: "evil.example.com" } })
    expect(evil.status).toBe(421)
    expect(JSON.parse(evil.text).error).toBe("host_not_allowed")
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST"]) {
      expect((await raw("/api/config", { headers: { Host: host } })).status).toBe(200)
    }
  })

  it("allows extra host names from ALLOWED_HOSTS", async () => {
    const proxied = await startDemo({ env: { ALLOWED_HOSTS: "Demo.Example.com" } })
    try {
      const url = new URL(proxied.url)
      const answer = await new Promise((resolve) =>
        http.get({ host: url.hostname, port: url.port, path: "/api/config", headers: { Host: "demo.example.com" } }, (res) => resolve(res.statusCode)),
      )
      expect(answer).toBe(200)
    } finally {
      await proxied.close()
    }
  })

  it("blocks state-changing requests that come from another website", async () => {
    const customerId = demo.store.list("customers")[0].id
    const body = JSON.stringify(sampleDraft(customerId))
    const headers = { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }

    const foreign = await raw("/api/invoices", { method: "POST", body, headers: { ...headers, Origin: "https://evil.example.com" } })
    expect(foreign.status).toBe(403)
    expect(JSON.parse(foreign.text).error).toBe("cross_origin_blocked")
    expect(demo.gateway.calls).toHaveLength(0)

    const own = await raw("/api/invoices/preview", { method: "POST", body, headers: { ...headers, Origin: demo.url } })
    expect(own.status).toBe(200)
  })

  it("lets other websites read nothing either: there is no CORS header", async () => {
    const answer = await raw("/api/config", { headers: { Origin: "https://evil.example.com" } })
    expect(answer.headers["access-control-allow-origin"]).toBeUndefined()
  })
})

describe("response headers", () => {
  it("sends a strict content security policy with every page and answer", async () => {
    for (const path of ["/", "/api/config", "/css/app.css"]) {
      const { headers } = await raw(path)
      const csp = String(headers["content-security-policy"])
      expect(csp, path).toContain("default-src 'self'")
      expect(csp, path).toContain("script-src 'self'")
      expect(csp, path).not.toContain("unsafe-inline")
      expect(csp, path).not.toContain("unsafe-eval")
      expect(csp, path).not.toMatch(/https?:\/\//)
      expect(headers["x-content-type-options"]).toBe("nosniff")
      expect(headers["x-frame-options"]).toBe("SAMEORIGIN")
      expect(headers["referrer-policy"]).toBe("no-referrer")
      expect(headers["x-powered-by"]).toBeUndefined()
    }
  })

  it("lets only the demo itself embed a stored PDF", async () => {
    const customerId = demo.store.list("customers")[0].id
    const created = await demo.post("/api/invoices", sampleDraft(customerId))
    const file = await demo.get(`/api/invoices/${created.body.id}/files/pdf`)
    expect(file.headers.get("content-security-policy")).toBe("frame-ancestors 'self'")
    expect(file.headers.get("cache-control")).toContain("no-store")
  })
})

describe("paths and ids", () => {
  it("never reads a file outside the data folder", async () => {
    for (const id of ["../../package.json", "..%2F..%2Fpackage.json", "inv_x/../../etc", "%2e%2e"]) {
      const { status } = await raw(`/api/invoices/${id}/files/pdf`)
      expect(status, id).toBe(404)
    }
    for (const id of ["../../package.json", "x.pdf/../../../etc/passwd", "a/b.pdf", "abc.pdf", ""]) {
      expect(await demo.store.readFile(id), id).toBeNull()
    }
  })

  it("serves only the public and shared folders", async () => {
    for (const path of ["/package.json", "/server/index.js", "/.env", "/data/db.json", "/shared/../package.json", "/%2e%2e/package.json", "/shared/..%2fpackage.json"]) {
      const { status } = await raw(path)
      expect([404, 400, 403], path).toContain(status)
    }
    expect((await raw("/shared/money.js")).status).toBe(200)
    expect((await raw("/")).status).toBe(200)
  })

  it("answers unknown API routes with JSON", async () => {
    const { status, body } = await demo.get("/api/nothing-here")
    expect([status, body.error]).toEqual([404, "not_found"])
  })
})

describe("the token", () => {
  it("never leaves the server", async () => {
    const customerId = demo.store.list("customers")[0].id
    await demo.post("/api/invoices", sampleDraft(customerId))
    const answers = await Promise.all(
      ["/api/config", "/api/settings", "/api/customers", "/api/invoices", "/api/incoming", "/api/stats", "/api/activity", "/api/health"].map((path) => demo.get(path)),
    )
    for (const answer of answers) expect(JSON.stringify(answer.body)).not.toContain("test-token")
    expect(JSON.stringify(demo.store.data)).not.toContain("test-token")
  })
})

describe("housekeeping", () => {
  it("resets to the sample data", async () => {
    await demo.store.reset()
    const customerId = demo.store.list("customers")[0].id
    await demo.post("/api/invoices", sampleDraft(customerId))
    expect(demo.store.list("invoices")).toHaveLength(1)
    expect((await demo.post("/api/demo/reset")).status).toBe(204)
    expect(demo.store.list("invoices")).toHaveLength(0)
    expect(demo.store.list("customers")).toHaveLength(3)
  })
})
