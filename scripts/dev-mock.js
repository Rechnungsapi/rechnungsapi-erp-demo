// Runs the whole demo against a local MOCK of the RechnungsAPI gateway.
//
//   npm run dev:mock                 start with the sample data
//   npm run dev:mock -- --seed       also create a few sample invoices
//   npm run dev:mock -- --no-token   start without a token, to see what a first-time visitor sees
//
// For working on the UI and for taking screenshots without an API token. Everything the mock
// returns is simulated: real documents and real validation come from RechnungsAPI.
// The data lives in a temporary folder and is gone when you stop the script.

import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadConfig } from "../server/config.js"
import { startServer } from "../server/start.js"
import { startMockGateway } from "../test/mock-gateway.js"
import { seedInvoices } from "./seed-demo.js"

const gateway = await startMockGateway({ latencyMs: 350, log: true })
const dataDir = await mkdtemp(path.join(os.tmpdir(), "rechnungsapi-erp-demo-mock-"))

const noToken = process.argv.includes("--no-token")
const config = loadConfig({
  ...process.env,
  DATA_DIR: dataDir,
  PORT: process.env.PORT ?? "3000",
  RECHNUNGSAPI_TOKEN: noToken ? "" : "mock-token",
  RECHNUNGSAPI_BASE_URL: gateway.url,
  RECHNUNGSAPI_V2_BASE_URL: gateway.url,
  DEMO_MOCK: noToken ? "0" : "1",
})
const demo = await startServer({ config })

if (!noToken && (process.argv.includes("--seed") || process.env.DEMO_SEED === "1")) {
  const created = await seedInvoices(demo.url)
  console.log(`  Created ${created.length} sample invoices`)
}

console.log(`
  RechnungsAPI demo ERP, running against the MOCK gateway
  ${demo.url}
  Mock gateway ${gateway.url}  (simulated answers)
`)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await demo.close()
    await gateway.close()
    process.exit(0)
  })
}
