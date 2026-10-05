import { toApiDateTime } from "../../shared/dates.js"
import { normalizeIban } from "../../shared/iban.js"
import { vatCategory } from "../../shared/money.js"

// Maps the ERP's own invoice to the EN 16931 invoice object that RechnungsAPI expects.
//
// The field names (invoiceNumber, seller.sellerVatIdentifier, vatBreakdown, ...) are the
// business terms of the standard, documented at https://rechnungsapi.de/api-docs#invoice-object.
// This is the file to adapt when your ERP stores its data differently.

/**
 * Drops empty values (empty strings, null, empty lists and objects) so the generated XML never
 * contains empty elements (rule PEPPOL-EN16931-R008). Numbers, including 0, are kept.
 */
export function prune(value) {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, prune(item)])
      .filter(([, item]) => item !== undefined)
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return value === "" || value === null || value === undefined ? undefined : value
}

/**
 * @param {{
 *   number: string,
 *   issueDate: string,
 *   dueDate: string,
 *   deliveryDate?: string,
 *   language: "de"|"en",
 *   seller: import("../../shared/types.js").Company,
 *   buyer: import("../../shared/types.js").Customer,
 *   lines: import("../../shared/types.js").Line[],
 *   totals: ReturnType<typeof import("../../shared/money.js").computeTotals>,
 *   buyerReference?: string,
 *   orderReference?: string,
 *   paymentTerms?: string,
 *   note?: string,
 *   exemptionReason?: string,
 * }} invoice
 * @returns {Record<string, unknown>}
 */
export function toApiInvoice(invoice) {
  const { seller, buyer, totals } = invoice

  return prune({
    invoiceNumber: invoice.number,
    invoiceIssueDate: toApiDateTime(invoice.issueDate),
    invoiceTypeCode: "380", // commercial invoice
    invoiceCurrencyCode: "EUR",
    paymentDueDate: invoice.dueDate,
    buyerReference: invoice.buyerReference,
    purchaseOrderReference: invoice.orderReference,
    paymentTerms: invoice.paymentTerms,
    invoiceNote: invoice.note ? [{ invoiceNote: invoice.note }] : [],
    deliveryInformation: { actualDeliveryDate: invoice.deliveryDate ? toApiDateTime(invoice.deliveryDate) : undefined },

    seller: {
      sellerName: seller.name,
      sellerVatIdentifier: seller.vatId,
      sellerElectronicAddress: seller.email,
      sellerPostalAddress: {
        sellerAddressLine1: seller.street,
        sellerCity: seller.city,
        sellerPostCode: seller.zip,
        sellerCountryCode: seller.country,
      },
      // XRechnung requires a contact person, phone number and e-mail address for the seller.
      sellerContact: {
        sellerContactPoint: seller.contactName,
        sellerContactTelephoneNumber: seller.phone,
        sellerContactEmailAddress: seller.email,
      },
    },

    buyer: {
      buyerName: buyer.name,
      buyerVatIdentifier: buyer.vatId,
      buyerElectronicAddress: buyer.email,
      buyerPostalAddress: {
        buyerAddressLine1: buyer.street,
        buyerCity: buyer.city,
        buyerPostCode: buyer.zip,
        buyerCountryCode: buyer.country,
      },
    },

    paymentInstructions: {
      paymentMeansTypeCode: "58", // SEPA credit transfer
      paymentMeansText: invoice.language === "de" ? "SEPA-Überweisung" : "SEPA credit transfer",
      remittanceInformation: invoice.number,
      creditTransfer: [
        {
          paymentAccountIdentifier: normalizeIban(seller.iban),
          paymentAccountName: seller.name,
          paymentServiceProviderIdentifier: seller.bic,
        },
      ],
    },

    documentTotals: {
      sumOfInvoiceLineNetAmount: totals.net,
      sumOfAllowancesOnDocumentLevel: 0,
      sumOfChargesOnDocumentLevel: 0,
      invoiceTotalAmountWithoutVat: totals.net,
      invoiceTotalVatAmount: totals.vat,
      invoiceTotalAmountWithVat: totals.gross,
      paidAmount: 0,
      roundingAmount: 0,
      amountDueForPayment: totals.gross,
    },

    vatBreakdown: totals.breakdown.map((group) => ({
      vatCategoryCode: group.category,
      vatCategoryRate: group.rate,
      vatCategoryTaxableAmount: group.taxable,
      vatCategoryTaxAmount: group.tax,
      // Exempt (category E) needs a reason (rule BR-E-10).
      vatExemptionReasonText: group.category === "E" ? invoice.exemptionReason : undefined,
    })),

    invoiceLine: invoice.lines.map((line, index) => ({
      invoiceLineIdentifier: String(index + 1),
      invoicedQuantity: line.quantity,
      invoicedQuantityUnitOfMeasureCode: line.unit,
      invoiceLineNetAmount: totals.lines[index].net,
      itemInformation: { itemName: line.description },
      // Gross price and net price are equal because the demo has no line discounts. Sending both
      // keeps rule PEPPOL-EN16931-R046 (net = gross - discount) satisfied.
      priceDetails: {
        itemNetPrice: line.unitPrice,
        itemGrossPrice: line.unitPrice,
        itemPriceDiscount: 0,
        itemPriceBaseQuantity: 1,
        itemPriceBaseQuantityUnitOfMeasure: line.unit,
      },
      lineVatInformation: [{ invoicedItemVatCategoryCode: vatCategory(line.vatRate), invoicedItemVatRate: line.vatRate }],
    })),
  })
}
