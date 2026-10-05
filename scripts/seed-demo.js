// Fills a running demo with a few sample invoices, created through its own API like a user would.
//
//   npm run demo:seed                         against http://localhost:3000
//   npm run demo:seed -- --url http://localhost:3001
//
// Each invoice is one call to RechnungsAPI. With your real token that uses six API calls, so the
// script asks for --yes unless the demo runs against the local mock gateway.

import { addDays, todayIso } from "../shared/dates.js"

const line = (description, quantity, unit, unitPrice, vatRate = 19) => ({ description, quantity, unit, unitPrice, vatRate })

/** The sample invoices: a mix of formats, customers and VAT rates. Dates are relative to today. */
export function sampleDrafts(customers, today = todayIso()) {
  const [industry, city, bakery] = customers
  const ago = (days) => addDays(today, -days)
  const draft = (customer, daysAgo, format, lines, extra = {}) => ({
    customerId: customer.id,
    issueDate: ago(daysAgo),
    dueDate: addDays(ago(daysAgo), 14),
    format,
    language: "de",
    buyerReference: customer.buyerReference,
    lines,
    ...extra,
  })

  return [
    draft(industry, 38, "zugferd", [
      line("Beratung Softwarearchitektur und Integrationskonzept", 12, "HUR", 145),
      line("Wartungsvertrag, Q3/2026", 3, "MON", 89.9),
      line("Fachbuch „E-Rechnung in der Praxis“", 2, "C62", 29.5, 7),
    ]),
    draft(city, 31, "xrechnung", [line("Softwarelizenz, jährlich", 1, "C62", 2400), line("Einrichtung und Schulung", 8, "HUR", 120)]),
    draft(bakery, 24, "zugferd", [line("Workshop E-Rechnung für das Team", 2, "DAY", 1200)]),
    draft(industry, 17, "zugferd", [line("Cloud-Hosting, 12 Monate", 12, "MON", 49), line("Datenmigration", 1, "LS", 890)]),
    draft(city, 9, "xrechnung", [line("Support und Weiterentwicklung", 20, "HUR", 95)]),
    draft(bakery, 3, "zugferd", [line("Kassensystem-Anbindung", 1, "LS", 1450), line("Einweisung vor Ort", 4, "HUR", 110)]),
  ]
}

/** @param {string} baseUrl */
export async function seedInvoices(baseUrl) {
  const get = async (path) => /** @type {Promise<any>} */ ((await fetch(`${baseUrl}${path}`)).json())
  const customers = await get("/api/customers")
  /** @type {any[]} */
  const created = []
  for (const draft of sampleDrafts(customers)) {
    const response = await fetch(`${baseUrl}/api/invoices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) })
    const body = /** @type {any} */ (await response.json())
    if (!response.ok) throw new Error(`Could not create a sample invoice: ${body.error} ${body.message ?? ""}`)
    created.push(body)
  }
  return created
}

// --- Command line ---------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const argument = (name) => process.argv[process.argv.indexOf(name) + 1]
  const baseUrl = (process.argv.includes("--url") ? argument("--url") : "http://localhost:3000").replace(/\/$/, "")

  const config = /** @type {any} */ (await fetch(`${baseUrl}/api/config`).then((response) => response.json()).catch(() => null))
  if (!config) {
    console.error(`No demo is running at ${baseUrl}. Start it first with: npm start`)
    process.exit(1)
  }
  if (!config.mock && !process.argv.includes("--yes")) {
    console.error("This creates 6 sample invoices with your real token and uses 6 API calls. Run it again with --yes to continue.")
    process.exit(1)
  }
  const created = await seedInvoices(baseUrl)
  console.log(`Created ${created.length} sample invoices: ${created.map((invoice) => invoice.number).join(", ")}`)
}
