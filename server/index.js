import { loadConfig, loadDotEnv } from "./config.js"
import { startServer } from "./start.js"

loadDotEnv()
const config = loadConfig()

let running
try {
  running = await startServer({ config })
} catch (error) {
  if (error?.code === "EADDRINUSE") {
    console.error(`\n  Port ${config.port} is already in use. Start the demo on another port, for example: PORT=3001 npm start\n`)
    process.exit(1)
  }
  throw error
}

const loopback = ["127.0.0.1", "localhost", "::1"].includes(config.host)
console.log(`
  RechnungsAPI demo ERP ${running.version}
  ${running.url}

  API token   ${running.einvoice.configured ? "configured" : "missing: create a free one at https://rechnungsapi.de/register and set RECHNUNGSAPI_TOKEN in .env"}
  Data        ${config.dataDir}
`)
if (process.env.DEMO_IN_DOCKER) {
  console.log("  Running in Docker. The demo has no login, so keep the port published on 127.0.0.1 only (docker-compose.yml does).\n")
} else if (!loopback) {
  console.warn(`  Warning: this demo has no login and listens on ${config.host}. Anyone who can reach it can use your token.\n`)
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => running.close().then(() => process.exit(0)))
}
