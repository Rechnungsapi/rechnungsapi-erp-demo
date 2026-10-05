import { execFile } from "node:child_process"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ADVICE, runLiveCheck } from "../scripts/live-check.js"
import { startMockGateway } from "./mock-gateway.js"

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/live-check.js")
const run = promisify(execFile)

/** @type {Awaited<ReturnType<typeof startMockGateway>>} */
let gateway
/** An empty folder to run the script in, so that no .env of the developer is read. */
let cwd = ""
beforeAll(async () => {
  gateway = await startMockGateway()
  cwd = await mkdtemp(path.join(os.tmpdir(), "erp-demo-check-cwd-"))
})
afterAll(async () => {
  await gateway.close()
  await rm(cwd, { recursive: true, force: true })
})

const envFor = (token, extra = {}) => ({ RECHNUNGSAPI_TOKEN: token, RECHNUNGSAPI_BASE_URL: gateway.url, RECHNUNGSAPI_V2_BASE_URL: gateway.url, ...extra })

/** Runs the command line with exactly this environment (nothing from the developer's shell). */
async function cli(args, env) {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, ...args], { cwd, env: { PATH: process.env.PATH ?? "", ...env } })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

describe("npm run check:live", () => {
  it("passes every step against a working gateway, and never prints the token", async () => {
    const lines = []
    const before = gateway.calls.length
    const result = await runLiveCheck({ env: envFor("secret-token-123", { DEMO_MOCK: "1" }), withAi: true, log: (line) => lines.push(line) })
    const output = lines.join("\n")

    expect(result).toEqual({ passed: 6, failed: 0, skipped: 0 })
    expect(output).toContain("All 6 steps passed")
    expect(output).not.toContain("secret-token-123")
    // It really went through the SDK to the gateway, with the token the person configured: 2 creations, 2 checks, 1 extraction, 1 AI read.
    const calls = gateway.calls.slice(before)
    expect(calls).toHaveLength(6)
    expect(calls.every((call) => call.token === "secret-token-123")).toBe(true)
  })

  it("leaves the demo data of the person alone", async () => {
    // The data folder a person configured is replaced by a throw-away one: nothing is created there.
    await runLiveCheck({ env: envFor("secret-token-123", { DEMO_MOCK: "1", DATA_DIR: path.join(cwd, "must-stay-unused") }), log: () => {} })
    expect(await readdir(cwd)).not.toContain("must-stay-unused")
  })

  it("explains a rejected token, and skips what depends on the failed steps", async () => {
    const lines = []
    const result = await runLiveCheck({ env: envFor("invalid-token", { DEMO_MOCK: "1" }), log: (line) => lines.push(line) })
    const output = lines.join("\n")

    expect(result).toEqual({ passed: 0, failed: 2, skipped: 3 })
    expect(output).toContain("FAIL")
    expect(output).toContain("SKIP")
    expect(output).toContain(ADVICE.unauthorized)
  })

  it("explains an outage of the gateway", async () => {
    const lines = []
    gateway.state.fail = { status: 503, body: { message: "down" } }
    try {
      const result = await runLiveCheck({ env: envFor("secret-token-123", { DEMO_MOCK: "1" }), log: (line) => lines.push(line) })
      expect(result.failed).toBeGreaterThan(0)
      expect(lines.join("\n")).toContain(ADVICE.upstream)
    } finally {
      gateway.state.fail = null
    }
  })
})

describe("the command line", () => {
  it("asks for a token first", async () => {
    const result = await cli([], { RECHNUNGSAPI_TOKEN: "" })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("No token is set")
  })

  it("asks for --yes before it uses a real token, and contacts nobody until then", async () => {
    const before = gateway.calls.length
    const result = await cli([], envFor("secret-token-123"))
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("--yes")
    expect(result.stderr).toContain("5 API calls")
    expect(result.stderr).not.toContain("secret-token-123")
    expect(gateway.calls.length).toBe(before)

    const withAi = await cli(["--with-ai"], envFor("secret-token-123"))
    expect(withAi.stderr).toContain("6 API calls")
  })

  it("runs the check with --yes and exits with 0 when everything passes", async () => {
    const result = await cli(["--yes"], envFor("secret-token-123"))
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("All 5 steps passed")
    expect(result.stdout + result.stderr).not.toContain("secret-token-123")
  })

  it("exits with 1 when a step fails", async () => {
    const result = await cli(["--yes"], envFor("invalid-token"))
    expect(result.code).toBe(1)
    expect(result.stdout).toContain(ADVICE.unauthorized)
  })
})
