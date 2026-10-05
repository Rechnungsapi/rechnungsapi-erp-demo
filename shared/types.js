// JSDoc type definitions for the data the demo stores and moves around.
// There is no runtime code in this file; `npm run typecheck` reads the types.

/**
 * @typedef {Object} Company  The seller, i.e. you.
 * @property {string} name
 * @property {string} street
 * @property {string} zip
 * @property {string} city
 * @property {string} country            ISO 3166-1 alpha-2, e.g. "DE"
 * @property {string} vatId              USt-IdNr., e.g. "DE123456789"
 * @property {string} email
 * @property {string} phone
 * @property {string} contactName
 * @property {string} iban
 * @property {string} bic
 * @property {string} [website]
 */

/**
 * @typedef {Object} Defaults
 * @property {number} paymentDays        Days until an invoice is due.
 * @property {number} vatRate            Pre-selected VAT rate for new lines.
 * @property {"de"|"en"} language        Language of the invoice PDF.
 * @property {"zugferd"|"xrechnung"} format
 */

/**
 * @typedef {Object} Settings
 * @property {Company} company
 * @property {Defaults} defaults
 */

/**
 * @typedef {Object} Customer
 * @property {string} id
 * @property {string} name
 * @property {string} street
 * @property {string} zip
 * @property {string} city
 * @property {string} country
 * @property {string} [vatId]
 * @property {string} email
 * @property {string} [buyerReference]   Leitweg-ID or the customer's own reference (BT-10).
 */

/**
 * @typedef {Object} Line
 * @property {string} description
 * @property {number} quantity
 * @property {string} unit               UN/ECE unit code, e.g. "C62" or "HUR".
 * @property {number} unitPrice          Net price per unit.
 * @property {number} vatRate            19, 7 or 0.
 */

/**
 * @typedef {Object} Transport  Send the invoice by e-mail in the same API call.
 * @property {string} sender
 * @property {string} [senderName]
 * @property {string} receiver
 * @property {string} [cc]
 * @property {string} [bcc]
 * @property {string} subject
 * @property {string} message
 */

/**
 * @typedef {Object} InvoiceDraft  What the form sends.
 * @property {string} customerId
 * @property {string} [number]
 * @property {string} issueDate
 * @property {string} dueDate
 * @property {string} [deliveryDate]
 * @property {"zugferd"|"xrechnung"} format
 * @property {"de"|"en"} language
 * @property {string} [buyerReference]
 * @property {string} [orderReference]
 * @property {string} [paymentTerms]
 * @property {string} [note]
 * @property {string} [exemptionReason]
 * @property {Line[]} lines
 * @property {Transport} [transport]
 */

/**
 * @typedef {Object} Issue  One finding of the e-invoice validation.
 * @property {string} rule               e.g. "BR-CO-25" or "BT-31"
 * @property {"error"|"warning"|"info"} severity
 * @property {string} message
 * @property {string} [location]
 * @property {string} [source]           The rule set that raised it.
 */

/**
 * @typedef {Object} InvoiceResult
 * @property {boolean} valid
 * @property {Issue[]} issues
 * @property {string} [message]
 * @property {string} [reference]
 * @property {boolean} [emailQueued]
 * @property {string} [checkedAt]        When it was last validated again.
 */

/**
 * @typedef {Object} InvoiceRecord
 * @property {string} id
 * @property {string} number
 * @property {"zugferd"|"xrechnung"} format
 * @property {"de"|"en"} language
 * @property {"valid"|"invalid"} status
 * @property {string} issueDate
 * @property {string} dueDate
 * @property {string} [deliveryDate]
 * @property {string} [buyerReference]
 * @property {string} [orderReference]
 * @property {string} [paymentTerms]
 * @property {string} [note]
 * @property {Company} seller
 * @property {Customer} buyer
 * @property {Line[]} lines
 * @property {ReturnType<typeof import("./money.js").computeTotals>} totals
 * @property {Record<string, unknown>} payload   The invoice object sent to the API (no PDF).
 * @property {InvoiceResult} result
 * @property {{ pdf?: string, xml?: string }} files   File ids in the store.
 * @property {string} [sentTo]           Recipients, when the invoice was e-mailed with the API call.
 * @property {string} createdAt
 */

/**
 * @typedef {Object} IncomingRecord  One action on a document you received.
 * @property {string} id
 * @property {"validate"|"extract"|"read"|"convert"} action
 * @property {string} fileName
 * @property {string} kind               pdf, xml, png, jpeg or tiff
 * @property {number} size               Bytes.
 * @property {boolean} ok
 * @property {Record<string, any>} data  What the action returned.
 * @property {string} [fileId]           A produced file, e.g. the converted ZUGFeRD PDF.
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ActivityEntry  One call to RechnungsAPI, without any content.
 * @property {string} id
 * @property {string} at
 * @property {string} name               The SDK method, e.g. "createZugferdFromJson".
 * @property {boolean} ok
 * @property {number} ms
 * @property {string} [code]
 */

/**
 * @typedef {Object} Db  Everything the demo stores.
 * @property {number} version
 * @property {Settings} settings
 * @property {Customer[]} customers
 * @property {InvoiceRecord[]} invoices
 * @property {IncomingRecord[]} incoming
 * @property {ActivityEntry[]} activity
 * @property {Record<string, number>} counters   Last used invoice counter per year.
 */

export {}
