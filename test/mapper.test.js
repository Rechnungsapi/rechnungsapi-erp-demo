import { describe, expect, it } from "vitest"
import { toApiInvoice, prune } from "../server/domain/to-api.js"
import { defaultCustomers, defaultSettings } from "../server/seed.js"
import { computeTotals } from "../shared/money.js"

// The invoice object as RechnungsAPI documents it (https://rechnungsapi.de/api-docs#invoice-object).
// Every key the demo sends must appear here, so a typo in a field name fails this test instead of
// silently producing an invoice with missing data. A list means "each item has this shape".
const DOCUMENTED = {
  invoiceNumber: 1, invoiceIssueDate: 1, invoiceTypeCode: 1, invoiceCurrencyCode: 1, vatAccountingCurrencyCode: 1,
  valueAddedTaxPointDate: 1, valueAddedTaxPointDateCode: 1, paymentDueDate: 1, buyerReference: 1,
  projectReference: { projectReferenceIdentifier: 1, projectReferenceName: 1 },
  contractReference: 1, purchaseOrderReference: 1, salesOrderReference: 1, receivingAdviceReference: 1,
  despatchAdviceReference: 1, tenderOrLotReference: 1, invoicedObjectIdentifier: 1, buyerAccountingReference: 1,
  paymentTerms: 1,
  invoiceNote: [{ invoiceNoteSubjectCode: 1, invoiceNote: 1 }],
  processControl: { businessProcessTypeIdentifier: 1, specificationIdentifier: 1 },
  precedingInvoiceReference: [{ precedingInvoiceReference: 1, precedingInvoiceIssueDate: 1 }],
  seller: {
    sellerName: 1, sellerTradingName: 1, sellerIdentifier: [1], sellerLegalRegistrationIdentifier: 1, sellerVatIdentifier: 1,
    sellerTaxRegistrationIdentifier: 1, sellerAdditionalLegalInformation: 1, sellerElectronicAddress: 1,
    sellerPostalAddress: {
      sellerAddressLine1: 1, sellerAddressLine2: 1, sellerAddressLine3: 1, sellerCity: 1, sellerPostCode: 1,
      sellerCountrySubdivision: 1, sellerCountryCode: 1,
    },
    sellerContact: { sellerContactPoint: 1, sellerContactTelephoneNumber: 1, sellerContactEmailAddress: 1 },
  },
  buyer: {
    buyerName: 1, buyerTradingName: 1, buyerIdentifier: 1, buyerLegalRegistrationIdentifier: 1, buyerVatIdentifier: 1,
    buyerElectronicAddress: 1,
    buyerPostalAddress: {
      buyerAddressLine1: 1, buyerAddressLine2: 1, buyerAddressLine3: 1, buyerCity: 1, buyerPostCode: 1,
      buyerCountrySubdivision: 1, buyerCountryCode: 1,
    },
    buyerContact: { buyerContactPoint: 1, buyerContactTelephoneNumber: 1, buyerContactEmailAddress: 1 },
  },
  payee: { payeeName: 1, payeeIdentifier: 1, payeeLegalRegistrationIdentifier: 1 },
  sellerTaxRepresentativeParty: { sellerTaxRepresentativeName: 1, sellerTaxRepresentativeVatIdentifier: 1, sellerTaxRepresentativePostalAddress: {} },
  deliveryInformation: {
    deliverToPartyName: 1, deliverToLocationIdentifier: 1, actualDeliveryDate: 1,
    deliverToAddress: {
      deliverToAddressLine1: 1, deliverToAddressLine2: 1, deliverToAddressLine3: 1, deliverToCity: 1, deliverToPostCode: 1,
      deliverToCountrySubdivision: 1, deliverToCountryCode: 1,
    },
  },
  invoicingPeriod: { invoicingPeriodStartDate: 1, invoicingPeriodEndDate: 1 },
  paymentInstructions: {
    paymentMeansTypeCode: 1, paymentMeansText: 1, remittanceInformation: 1,
    creditTransfer: [{ paymentAccountIdentifier: 1, paymentAccountName: 1, paymentServiceProviderIdentifier: 1 }],
    paymentCardInformation: { paymentCardPrimaryAccountNumber: 1, paymentCardHolderName: 1 },
    directDebit: { mandateReferenceIdentifier: 1, bankAssignedCreditorIdentifier: 1, debitedAccountIdentifier: 1 },
  },
  documentLevelAllowances: [{ documentLevelAllowanceAmount: 1 }],
  documentLevelCharges: [{ documentLevelChargeAmount: 1 }],
  documentTotals: {
    sumOfInvoiceLineNetAmount: 1, sumOfAllowancesOnDocumentLevel: 1, sumOfChargesOnDocumentLevel: 1,
    invoiceTotalAmountWithoutVat: 1, invoiceTotalVatAmount: 1, invoiceTotalVatAmountInAccountingCurrency: 1,
    invoiceTotalAmountWithVat: 1, paidAmount: 1, roundingAmount: 1, amountDueForPayment: 1,
  },
  vatBreakdown: [{
    vatCategoryTaxableAmount: 1, vatCategoryTaxAmount: 1, vatCategoryCode: 1, vatCategoryRate: 1,
    vatExemptionReasonText: 1, vatExemptionReasonCode: 1,
  }],
  additionalSupportingDocuments: [{ supportingDocumentReference: 1 }],
  invoiceLine: [{
    invoiceLineIdentifier: 1, invoiceLineNote: 1, invoiceLineObjectIdentifier: 1, invoicedQuantity: 1,
    invoicedQuantityUnitOfMeasureCode: 1, invoiceLineNetAmount: 1, referencedPurchaseOrderLineReference: 1,
    invoiceLineBuyerAccountingReference: 1,
    priceDetails: { itemNetPrice: 1, itemPriceDiscount: 1, itemGrossPrice: 1, itemPriceBaseQuantity: 1, itemPriceBaseQuantityUnitOfMeasure: 1 },
    lineVatInformation: [{ invoicedItemVatCategoryCode: 1, invoicedItemVatRate: 1 }],
    itemInformation: { itemName: 1, itemDescription: 1, itemSellersIdentifier: 1, itemBuyersIdentifier: 1 },
  }],
}

/** Lists every key in `value` that the documented shape does not know. */
function unknownKeys(value, shape, at = "") {
  if (Array.isArray(shape)) {
    return Array.isArray(value) ? value.flatMap((item, index) => unknownKeys(item, shape[0], `${at}[${index}]`)) : []
  }
  if (shape && typeof shape === "object" && value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      key in shape ? unknownKeys(item, shape[key], `${at}.${key}`) : [`${at}.${key}`],
    )
  }
  return []
}

const seller = defaultSettings().company
const buyer = defaultCustomers()[0]

function build(overrides = {}) {
  const lines = overrides.lines ?? [
    { description: "Beratung", quantity: 12, unit: "HUR", unitPrice: 145, vatRate: 19 },
    { description: "Buch", quantity: 2, unit: "C62", unitPrice: 29.5, vatRate: 7 },
  ]
  return {
    number: "RE-2026-0001",
    issueDate: "2026-10-05",
    dueDate: "2026-10-19",
    language: "de",
    seller,
    buyer,
    lines,
    totals: computeTotals(lines),
    buyerReference: "PO-1",
    paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
    ...overrides,
  }
}

describe("the invoice object sent to the API", () => {
  it("uses only field names the API documents", () => {
    expect(unknownKeys(toApiInvoice(build({ note: "n", orderReference: "o", deliveryDate: "2026-09-30" })), DOCUMENTED)).toEqual([])
  })

  it("contains what an XRechnung requires from the seller (contact person, phone, e-mail)", () => {
    const { seller: sent } = toApiInvoice(build())
    expect(sent.sellerContact).toEqual({
      sellerContactPoint: "Erika Mustermann",
      sellerContactTelephoneNumber: "+49 40 1234567",
      sellerContactEmailAddress: "rechnung@example.com",
    })
    expect(sent.sellerElectronicAddress).toBe("rechnung@example.com")
    expect(sent.sellerVatIdentifier).toBe("DE123456789")
  })

  it("sends dates as the API expects them", () => {
    const sent = toApiInvoice(build({ deliveryDate: "2026-09-30" }))
    expect(sent.invoiceIssueDate).toBe("2026-10-05T00:00:00")
    expect(sent.paymentDueDate).toBe("2026-10-19")
    expect(sent.deliveryInformation).toEqual({ actualDeliveryDate: "2026-09-30T00:00:00" })
  })

  it("sends the IBAN without spaces and names the payment method", () => {
    const sent = toApiInvoice(build({ seller: { ...seller, iban: "de89 3704 0044 0532 0130 00" } }))
    expect(sent.paymentInstructions).toMatchObject({
      paymentMeansTypeCode: "58",
      paymentMeansText: "SEPA-Überweisung",
      remittanceInformation: "RE-2026-0001",
      creditTransfer: [{ paymentAccountIdentifier: "DE89370400440532013000", paymentServiceProviderIdentifier: "COBADEFFXXX" }],
    })
    expect(toApiInvoice(build({ language: "en" })).paymentInstructions.paymentMeansText).toBe("SEPA credit transfer")
  })

  it("sends the same totals the form shows", () => {
    const sent = toApiInvoice(build())
    expect(sent.documentTotals).toEqual({
      sumOfInvoiceLineNetAmount: 1799,
      sumOfAllowancesOnDocumentLevel: 0,
      sumOfChargesOnDocumentLevel: 0,
      invoiceTotalAmountWithoutVat: 1799,
      invoiceTotalVatAmount: 334.73,
      invoiceTotalAmountWithVat: 2133.73,
      paidAmount: 0,
      roundingAmount: 0,
      amountDueForPayment: 2133.73,
    })
    expect(sent.vatBreakdown).toHaveLength(2)
  })

  it("describes each line with a net price that equals the gross price", () => {
    const [line] = toApiInvoice(build()).invoiceLine
    expect(line).toEqual({
      invoiceLineIdentifier: "1",
      invoicedQuantity: 12,
      invoicedQuantityUnitOfMeasureCode: "HUR",
      invoiceLineNetAmount: 1740,
      itemInformation: { itemName: "Beratung" },
      priceDetails: { itemNetPrice: 145, itemGrossPrice: 145, itemPriceDiscount: 0, itemPriceBaseQuantity: 1, itemPriceBaseQuantityUnitOfMeasure: "HUR" },
      lineVatInformation: [{ invoicedItemVatCategoryCode: "S", invoicedItemVatRate: 19 }],
    })
  })

  it("never sends an empty value, because empty XML elements are invalid", () => {
    const sent = toApiInvoice(build({ buyerReference: "", paymentTerms: "", buyer: { ...buyer, vatId: "" } }))
    const empties = []
    const walk = (value, at) => {
      if (value === "" || value === null || value === undefined) empties.push(at)
      else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${at}[${index}]`))
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walk(item, `${at}.${key}`))
    }
    walk(sent, "")
    expect(empties).toEqual([])
    expect(sent).not.toHaveProperty("buyerReference")
    expect(sent.buyer).not.toHaveProperty("buyerVatIdentifier")
  })
})

describe("prune", () => {
  it("drops empty strings, null, empty lists and objects, and keeps zero and false", () => {
    expect(prune({ a: "", b: null, c: [], d: {}, e: 0, f: false, g: [{ h: "" }, { i: 1 }], j: { k: "" } })).toEqual({ e: 0, f: false, g: [{ i: 1 }] })
    expect(prune("")).toBeUndefined()
    expect(prune(5)).toBe(5)
  })
})
