# Adapting it to your ERP

You do not have to start from this demo to use RechnungsAPI. But if you want a head start, two files carry the integration:

- [`server/domain/to-api.js`](../server/domain/to-api.js) turns your invoice into the EN 16931 invoice object.
- [`server/einvoice.js`](../server/einvoice.js) calls the API and hides its details.

The full list of fields is the [invoice object reference](https://rechnungsapi.de/api-docs#invoice-object) in the documentation. Every field is named after a business term (`BT-1`, `BT-27`, ...) of the standard.

## 1. Map your data

The demo fills these fields. Replace the right-hand side with your own data.

| Your concept | Invoice object field | Term |
|---|---|---|
| Invoice number | `invoiceNumber` | BT-1 |
| Invoice date | `invoiceIssueDate` (as `YYYY-MM-DDT00:00:00`) | BT-2 |
| Payment due date | `paymentDueDate` (as `YYYY-MM-DD`) | BT-9 |
| Customer reference, Leitweg-ID | `buyerReference` | BT-10 |
| Order number | `purchaseOrderReference` | BT-13 |
| Payment terms | `paymentTerms` | BT-20 |
| Your company | `seller.sellerName`, `sellerPostalAddress`, `sellerVatIdentifier` | BT-27, BG-5, BT-31 |
| Your contact person | `seller.sellerContact` (name, phone, e-mail) | BT-41 to BT-43 |
| Your customer | `buyer.buyerName`, `buyerPostalAddress`, `buyerElectronicAddress` | BT-44, BG-8, BT-49 |
| Bank account | `paymentInstructions.creditTransfer[].paymentAccountIdentifier` (IBAN, no spaces) | BT-84 |
| Items | `invoiceLine[]` with quantity, unit, net price and VAT | BG-25 |
| Totals | `documentTotals` and `vatBreakdown[]` | BG-22, BG-23 |

Two things are easy to trip over:

- **Dates.** Send the invoice date as `YYYY-MM-DDT00:00:00` without a time zone offset and the due date as a plain `YYYY-MM-DD`. Dates that come back from the PDF analyzer are `DD.MM.YYYY` and need converting (`shared/dates.js` has `fromGermanDate`).
- **Empty values.** Leave out fields you have no value for instead of sending `""` or `null`: an empty value becomes an empty XML element, which the rule `PEPPOL-EN16931-R008` forbids. The `prune` function in `to-api.js` does this for the whole object.

### What an XRechnung needs on top of a ZUGFeRD

An XRechnung is stricter. The demo asks for these before it even calls the API:

- a **buyer reference** (BT-10), for example a Leitweg-ID for public authorities or your customer's order number,
- a **contact person, phone number and e-mail address** for the seller (BT-41 to BT-43),
- a **payment due date or payment terms** (rule `BR-CO-25`),
- the **seller's VAT identifier** (BT-31).

## 2. Totals and VAT

The standard checks your arithmetic (`BR-CO-10` to `BR-CO-17`), so compute it the way it describes:

- the net amount of a line is quantity times unit price, rounded to two decimals,
- VAT is calculated **once per VAT group** from the sum of the net amounts, not per line,
- sums are exact: add cents, not floating point numbers.

[`shared/money.js`](../shared/money.js) does exactly that and has tests for the traps. Reuse it or port it.

The demo offers 19 %, 7 % and 0 %. Standard rates are category `S`; a tax-exempt line is category `E` and needs an exemption reason (`BR-E-10`). Other categories such as reverse charge (`AE`) work the same way: add the code in `vatCategory`, carry the reason or code into the `vatBreakdown`, and let the API validate the combination.

## 3. The visual PDF

A ZUGFeRD invoice is a PDF that people read with the XML embedded in it. RechnungsAPI embeds the XML, but you provide the PDF. The demo draws one with [PDFKit](https://pdfkit.org) in `server/pdf/invoice-pdf.js`.

Replace `renderInvoicePdf` with whatever your ERP already produces. The API only needs the bytes, and the numbers on the PDF should match the data you send.

## 4. Reading invoices you receive

`einvoice.read` uses the PDF analyzer, which also accepts scans and photos. Two practical notes:

- Treat the `confidence` it returns as a signal: below about 70, have a person look at the result before you book it.
- Analysis takes roughly 7 to 25 seconds, and a conversion with `createZugferdFromPdf` can take minutes for long documents. Use the SDK's asynchronous analysis (`analyzePdfInvoiceAsync` and `getAnalysisStatus`) for large files, and don't put a short timeout in front of these calls.

## 5. When the validation says no

A finding names a rule. These are the ones you will meet first:

| Rule | What it means | Usual fix |
|---|---|---|
| `BR-CO-17` | The VAT amount of a category is not taxable amount times rate, rounded. | Compute VAT per group (see above). |
| `BR-CO-15`, `BR-CO-16` | Total with VAT, or the amount due, does not add up. | Check the totals and the paid amount. |
| `BR-CO-25` | An amount is due, but there is no due date and no payment terms. | Send `paymentDueDate` or `paymentTerms`. |
| `BR-DE-15` | An XRechnung needs a buyer reference. | Send `buyerReference`. |
| `BT-31` | The seller's VAT identifier is missing. | Send `seller.sellerVatIdentifier`. |
| `BR-E-10` | A tax-exempt line has no exemption reason. | Send `vatExemptionReasonText` or `vatExemptionReasonCode`. |
| `PEPPOL-EN16931-R008` | The document contains an empty element. | Don't send empty values. |
| `PEPPOL-EN16931-R046` | The net price is not gross price minus discount. | Send both prices, equal when there is no discount. |

## 6. Before you go to production

The demo is a reference, not a product. For a real system, plan for:

- **Login and authorization.** The demo has none.
- **A database** instead of a JSON file, and backups.
- **Secrets management** for the token, instead of a `.env` file.
- **Retries and duplicates.** `createZugferdFromPdf` has no idempotency key: sending the same file twice converts and bills it twice. Deduplicate double submits on your side.
- **Archiving.** Keep the original documents as your tax rules require. Ask your tax advisor how long and in what form.
- **Monitoring.** Log the `reference` that conversions return; support needs it to trace a document.

Questions about any of this? [Talk to us](https://rechnungsapi.de/contact).
