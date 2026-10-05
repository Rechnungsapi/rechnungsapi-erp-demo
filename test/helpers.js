import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadConfig } from "../server/config.js"
import { startServer } from "../server/start.js"
import { startMockGateway } from "./mock-gateway.js"

/**
 * Starts the demo on a free port against a mock gateway, with its own empty data folder.
 * Call `close()` when the test is done.
 *
 * @param {{ token?: string, gateway?: Awaited<ReturnType<typeof startMockGateway>>, env?: Record<string, string> }} [options]
 */
export async function startDemo({ token = "test-token", gateway, env = {} } = {}) {
  const mock = gateway ?? (await startMockGateway())
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "erp-demo-test-"))
  const config = loadConfig({
    DATA_DIR: dataDir,
    PORT: "0",
    RECHNUNGSAPI_TOKEN: token,
    RECHNUNGSAPI_BASE_URL: mock.url,
    RECHNUNGSAPI_V2_BASE_URL: mock.url,
    DEMO_MOCK: "1",
    ...env,
  })
  const running = await startServer({ config })

  /**
   * One request to the demo. JSON bodies are parsed; everything else is returned as a Buffer.
   *
   * @param {string} method
   * @param {string} url
   * @param {unknown} [body]
   * @param {Record<string, string>} [headers]
   */
  async function request(method, url, body, headers = {}) {
    const response = await fetch(`${running.url}${url}`, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const type = response.headers.get("content-type") ?? ""
    const parsed = type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer())
    return { status: response.status, body: /** @type {any} */ (parsed), headers: response.headers }
  }

  return {
    ...running,
    config,
    gateway: mock,
    request,
    get: (url, headers) => request("GET", url, undefined, headers),
    post: (url, body, headers) => request("POST", url, body ?? {}, headers),
    put: (url, body) => request("PUT", url, body),
    del: (url) => request("DELETE", url),
    async close() {
      await running.close()
      if (!gateway) await mock.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

/** A valid invoice form for the first sample customer. */
export function sampleDraft(customerId, overrides = {}) {
  return {
    customerId,
    issueDate: "2026-10-05",
    dueDate: "2026-10-19",
    deliveryDate: "2026-09-30",
    format: "zugferd",
    language: "de",
    buyerReference: "PO-2026-4711",
    orderReference: "B-100",
    note: "Danke!",
    lines: [
      { description: "Beratung Softwarearchitektur", quantity: 12, unit: "HUR", unitPrice: 145, vatRate: 19 },
      { description: "Wartungsvertrag", quantity: 3, unit: "MON", unitPrice: 89.9, vatRate: 19 },
      { description: "Fachbuch", quantity: 2, unit: "C62", unitPrice: 29.5, vatRate: 7 },
    ],
    ...overrides,
  }
}

/** A tiny but real PDF. */
export const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")

/** The same, as the base64 string the API and the upload routes use. */
export const base64 = (buffer) => Buffer.from(buffer).toString("base64")
