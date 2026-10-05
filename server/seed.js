import { newId } from "./ids.js"

// Sample data for the first start. Every name, number and address is made up:
// the names are the usual German placeholders and the e-mail addresses use the reserved
// example.* domains, so nothing here can reach a real company or person.

/** @returns {import("../shared/types.js").Settings} */
export function defaultSettings() {
  return {
    company: {
      name: "Beispiel Software GmbH",
      street: "Musterstraße 12",
      zip: "20095",
      city: "Hamburg",
      country: "DE",
      vatId: "DE123456789",
      email: "rechnung@example.com",
      phone: "+49 40 1234567",
      contactName: "Erika Mustermann",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
      website: "",
    },
    defaults: { paymentDays: 14, vatRate: 19, language: "de", format: "zugferd" },
  }
}

/** @returns {import("../shared/types.js").Customer[]} */
export function defaultCustomers() {
  return [
    {
      id: newId("cus_"),
      name: "Muster Maschinenbau GmbH",
      street: "Industriestraße 5",
      zip: "70173",
      city: "Stuttgart",
      country: "DE",
      vatId: "DE987654321",
      email: "einkauf@example.org",
      buyerReference: "PO-2026-4711",
    },
    {
      id: newId("cus_"),
      name: "Stadtverwaltung Beispielstadt",
      street: "Rathausplatz 1",
      zip: "50667",
      city: "Köln",
      country: "DE",
      vatId: "",
      email: "rechnungseingang@example.net",
      buyerReference: "04011000-1234512345-06",
    },
    {
      id: newId("cus_"),
      name: "Beispiel Bäckerei KG",
      street: "Hauptstraße 8",
      zip: "80331",
      city: "München",
      country: "DE",
      vatId: "",
      email: "info@example.com",
      buyerReference: "",
    },
  ]
}

/** The whole database as it looks right after the first start. @returns {import("../shared/types.js").Db} */
export function defaultDb() {
  return {
    version: 1,
    settings: defaultSettings(),
    customers: defaultCustomers(),
    invoices: [],
    incoming: [],
    activity: [],
    counters: {},
  }
}
