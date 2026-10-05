// Checks that the demo works with YOUR token, against the live RechnungsAPI.
//
//   npm run check:live                      shows what it would do
//   npm run check:live -- --yes             runs it and uses 5 API calls
//   npm run check:live -- --yes --with-ai   also reads a PDF with AI: 1 more call, 10 to 25 seconds
//
// It starts a private copy of the demo with a throw-away data folder, so your own data stays
// untouched, and uses it like a person would: it creates a ZUGFeRD and an XRechnung invoice from the
// sample data (made-up companies), checks both again, and reads the data embedded in the ZUGFeRD PDF.
// The token comes from .env or the environment. It is never printed.

import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { loadConfig, loadDotEnv } from "../server/config.js"
import { startServer } from "../server/start.js"
import { sampleDrafts } from "./seed-demo.js"

/** What to do about each kind of failure, by the error code the demo reports. */
export const ADVICE = {
  no_token: "No token is set. Create a free one at https://rechnungsapi.de/register and put it into .env as RECHNUNGSAPI_TOKEN=...",
  unauthorized: "RechnungsAPI did not accept the token. Copy it again into .env as RECHNUNGSAPI_TOKEN=... (no quotes, no spaces).",
  no_access: "The token is valid, but it may not use this function. Check the plan of your account on https://rechnungsapi.de.",
  rate_limited: "Too many requests at the moment. Wait a minute and run the check again.",
  timeout: "RechnungsAPI did not answer in time. Run the check again.",
  unreachable: "RechnungsAPI could not be reached. Check the internet connection, a proxy or a firewall.",
  upstream: "RechnungsAPI had a problem on its side. Run the check again in a few minutes.",
}

/** A step failed for a reason the person can act on. */
class StepError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** The first findings of a validation, in one line. @param {any[]} [issues] */
const describe = (issues = []) =>
  issues
    .slice(0, 3)
    .map((issue) => `${issue.rule ? `${issue.rule}: ` : ""}${issue.message}`)
    .join("; ") || "no details"

/**
 * Runs the check against whatever gateway the environment points at.
 *
 * @param {{ env?: NodeJS.ProcessEnv, withAi?: boolean, log?: (line: string) => void }} [options]
 * @returns {Promise<{ passed: number, failed: number, skipped: number }>}
 */
export async function runLiveCheck({ env = process.env, withAi = false, log = console.log } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "rechnungsapi-erp-demo-check-"))
  const config = loadConfig({ ...env, DATA_DIR: dataDir, PORT: "0", HOST: "127.0.0.1" })
  const demo = await startServer({ config }).catch(async (error) => {
    await rm(dataDir, { recursive: true, force: true })
    throw error
  })

  /** One request to the private demo; a refusal becomes a StepError with the demo's own words. */
  const call = async (method, url, body) => {
    const response = await fetch(`${demo.url}${url}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const isJson = (response.headers.get("content-type") ?? "").includes("json")
    /** @type {any} */
    const payload = isJson ? await response.json() : Buffer.from(await response.arrayBuffer())
    if (!response.ok) throw new StepError(payload?.error ?? `http_${response.status}`, payload?.message ?? `HTTP ${response.status}`)
    return payload
  }

  /** What the steps hand on to each other. @type {Record<string, any>} */
  const state = {}

  /** @type {Array<{ name: string, needs?: string[], run: () => Promise<string> }>} */
  const steps = [
    {
      name: "Create a ZUGFeRD invoice",
      async run() {
        const draft = sampleDrafts(await call("GET", "/api/customers"))[0]
        const invoice = await call("POST", "/api/invoices", draft)
        if (!invoice.result.valid) throw new StepError("invalid", `RechnungsAPI reports the invoice as invalid: ${describe(invoice.result.issues)}`)
        const pdf = await call("GET", `/api/invoices/${invoice.id}/files/pdf`)
        if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new StepError("no_pdf", "The answer does not contain a PDF.")
        state.zugferd = { ...invoice, pdf }
        return `${invoice.number}, valid, PDF ${Math.round(pdf.length / 1024)} KB`
      },
    },
    {
      name: "Create an XRechnung",
      async run() {
        const draft = sampleDrafts(await call("GET", "/api/customers"))[1]
        const invoice = await call("POST", "/api/invoices", draft)
        if (!invoice.result.valid) throw new StepError("invalid", `RechnungsAPI reports the invoice as invalid: ${describe(invoice.result.issues)}`)
        const xml = (await call("GET", `/api/invoices/${invoice.id}/files/xml`)).toString("utf8")
        if (!xml.trimStart().startsWith("<") || !xml.includes(invoice.number)) throw new StepError("no_xml", "The answer does not contain the XML of this invoice.")
        state.xrechnung = invoice
        return `${invoice.number}, valid, XML ${Math.round(xml.length / 1024)} KB`
      },
    },
    {
      name: "Check the ZUGFeRD PDF again",
      needs: ["zugferd"],
      async run() {
        const checked = await call("POST", `/api/invoices/${state.zugferd.id}/revalidate`)
        if (!checked.result.valid) throw new StepError("invalid", `RechnungsAPI reports the PDF as invalid: ${describe(checked.result.issues)}`)
        return "valid"
      },
    },
    {
      name: "Check the XRechnung XML again",
      needs: ["xrechnung"],
      async run() {
        const checked = await call("POST", `/api/invoices/${state.xrechnung.id}/revalidate`)
        if (!checked.result.valid) throw new StepError("invalid", `RechnungsAPI reports the XML as invalid: ${describe(checked.result.issues)}`)
        return "valid"
      },
    },
    {
      name: "Read the data embedded in the PDF",
      needs: ["zugferd"],
      async run() {
        const record = await call("POST", "/api/incoming", { action: "extract", fileName: `${state.zugferd.number}.pdf`, fileBase64: state.zugferd.pdf.toString("base64") })
        if (!JSON.stringify(record.data?.invoice ?? "").includes(state.zugferd.number)) throw new StepError("mismatch", "The embedded data does not contain this invoice's number.")
        return `found ${state.zugferd.number}`
      },
    },
  ]
  if (withAi) {
    steps.push({
      name: "Read the PDF with AI",
      needs: ["zugferd"],
      async run() {
        const record = await call("POST", "/api/incoming", { action: "read", fileName: `${state.zugferd.number}.pdf`, fileBase64: state.zugferd.pdf.toString("base64") })
        if (typeof record.data?.confidence !== "number" || !record.data?.invoice) throw new StepError("mismatch", "The answer holds no invoice data.")
        return `confidence ${Math.round(record.data.confidence)} / 100`
      },
    })
  }

  log(`\n  RechnungsAPI demo ERP ${demo.version}: check against ${config.baseUrl ?? "the live RechnungsAPI"}\n`)
  const counts = { passed: 0, failed: 0, skipped: 0 }
  /** @type {Set<string>} */
  const codes = new Set()
  const width = Math.max(...steps.map((step) => step.name.length))

  try {
    for (const step of steps) {
      const label = step.name.padEnd(width)
      const missing = (step.needs ?? []).find((need) => !state[need])
      if (missing) {
        counts.skipped += 1
        log(`  SKIP  ${label}  an earlier step failed`)
        continue
      }
      const started = performance.now()
      try {
        const detail = await step.run()
        counts.passed += 1
        log(`  PASS  ${label}  ${((performance.now() - started) / 1000).toFixed(1)} s  ${detail}`)
      } catch (error) {
        counts.failed += 1
        const code = error instanceof StepError ? error.code : "unexpected"
        codes.add(code)
        log(`  FAIL  ${label}  ${error instanceof Error ? error.message : String(error)} (${code})`)
      }
    }
  } finally {
    await demo.close()
    await rm(dataDir, { recursive: true, force: true })
  }

  log("")
  if (counts.failed === 0) {
    log(`  All ${counts.passed} steps passed: the demo works with your token.\n`)
  } else {
    log(`  ${counts.passed} of ${steps.length} steps passed.`)
    for (const code of codes) if (code in ADVICE) log(`  ${ADVICE[/** @type {keyof typeof ADVICE} */ (code)]}`)
    log("")
  }
  return counts
}

// --- Command line ---------------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv()
  const config = loadConfig()
  const withAi = process.argv.includes("--with-ai")
  if (!config.token) {
    console.error(`\n  ${ADVICE.no_token}\n`)
    process.exit(1)
  }
  if (!config.mock && !process.argv.includes("--yes")) {
    console.error(`
  This checks the demo against the live RechnungsAPI with your token. It creates two sample
  invoices (made-up companies, nothing is e-mailed) and uses ${withAi ? 6 : 5} API calls of your account.
  Your own demo data is not touched.

  Run it again with --yes to continue.
`)
    process.exit(1)
  }
  const { failed } = await runLiveCheck({ withAi })
  process.exit(failed ? 1 : 0)
}
