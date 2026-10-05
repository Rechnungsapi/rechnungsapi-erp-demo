import { readFileSync } from "node:fs"
import { activityLogger } from "./activity.js"
import { createApp } from "./app.js"
import { createEInvoice } from "./einvoice.js"
import { Store } from "./store.js"

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

/**
 * Starts the demo. The command line (index.js), the mock-gateway script and the tests all use it.
 *
 * @param {{
 *   config: import("./config.js").Config,
 *   store?: Store,
 *   einvoice?: ReturnType<typeof createEInvoice>,
 * }} options
 */
export async function startServer({ config, store, einvoice }) {
  const database = store ?? (await new Store(config.dataDir).init())
  const service =
    einvoice ??
    createEInvoice({ token: config.token, baseUrl: config.baseUrl, v2BaseUrl: config.v2BaseUrl, onCall: activityLogger(database) })

  const app = createApp({ config, store: database, einvoice: service, version })
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(config.port, config.host, () => resolve(listening))
    listening.once("error", reject)
  })
  const address = /** @type {import("node:net").AddressInfo} */ (server.address())
  const host = config.host === "0.0.0.0" || config.host === "::" ? "localhost" : config.host

  return {
    app,
    store: database,
    einvoice: service,
    version,
    url: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  }
}
