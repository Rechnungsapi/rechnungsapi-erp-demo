import { html, useEffect, useState } from "../vendor/htm-preact.js"
import { UNITS } from "/shared/constants.js"
import { api } from "../api.js"
import { useApp } from "../context.js"
import { Banner, Button, Card, CodeBlock, ConfirmModal, EmptyState, FormatBadge, IssueList, KeyValues, LinkButton, Loading, PageHeader, ResultBox, StatusBadge, Tabs, useSourceTruncated } from "../ui.js"

const SNIPPETS = {
  zugferd: `import { RechnungsApiClient } from "rechnungsapi-sdk"

const client = new RechnungsApiClient({ apiToken: process.env.RECHNUNGSAPI_TOKEN })

// invoice: the JSON from the "API request" tab
// invoicePdf: your invoice layout as a PDF (a Buffer)
const result = await client.createZugferdFromJson(invoice, invoicePdf.toString("base64"))

// The result holds the ZUGFeRD PDF/A-3 (base64), the embedded XML and the validation findings.`,
  xrechnung: `import { RechnungsApiClient } from "rechnungsapi-sdk"

const client = new RechnungsApiClient({ apiToken: process.env.RECHNUNGSAPI_TOKEN })

// invoice: the JSON from the "API request" tab
const result = await client.createXRechnungFromJson(invoice)

// The result holds the XRechnung XML and the validation findings.`,
}

export function InvoiceDetailPage({ route }) {
  const { t, tn, lang, fmt, navigate, toast, errorText } = useApp()
  const id = route.params.id
  const [invoice, setInvoice] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(null)
  const [xml, setXml] = useState(null)
  const [checking, setChecking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api.get(`/invoices/${id}`).then((record) => {
      setInvoice(record)
      setTab(record.files.pdf ? "document" : "xml")
    }).catch(setError)
  }, [id])

  useEffect(() => {
    if (tab === "xml" && xml === null && invoice?.files.xml) api.text(`/invoices/${id}/files/xml`).then(setXml).catch(() => setXml(""))
  }, [tab, invoice])

  const xmlCut = useSourceTruncated(xml ?? "", "xml")

  if (error) {
    return html`<${EmptyState} icon="invoice" title=${errorText(error)}><${LinkButton} href="#/invoices">${t("det.back")}<//><//>`
  }
  if (!invoice) return html`<${Loading} />`

  const { result, files } = invoice
  const fileUrl = (kind, download) => `/api/invoices/${id}/files/${kind}${download ? "?download=1" : ""}`
  const unitName = (code) => UNITS.find((unit) => unit.code === code)?.[lang] ?? code

  async function recheck() {
    setChecking(true)
    try {
      setInvoice(await api.post(`/invoices/${id}/revalidate`))
    } catch (failure) {
      toast(errorText(failure), "err")
    } finally {
      setChecking(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await api.del(`/invoices/${id}`)
      toast(t("common.deleted"))
      navigate("/invoices")
    } catch (failure) {
      toast(errorText(failure), "err")
      setDeleting(false)
      setConfirming(false)
    }
  }

  const tabs = [
    files.pdf ? { id: "document", label: t("det.tab.document") } : null,
    files.xml ? { id: "xml", label: t("det.tab.xml") } : null,
    { id: "request", label: t("det.tab.request") },
    { id: "details", label: t("det.tab.details") },
    { id: "code", label: t("det.tab.code") },
  ].filter(Boolean)

  return html`
    <div><a class="small" href="#/invoices">← ${t("det.back")}</a></div>

    <${PageHeader}
      title=${html`<span class="mono">${invoice.number}</span>`}
      subtitle=${html`${invoice.buyer.name} · ${t("det.issuedOn", { date: fmt.date(invoice.issueDate) })} · ${t("det.dueOn", { date: fmt.date(invoice.dueDate) })}`}
    >
      <${FormatBadge} format=${invoice.format} />
      <${StatusBadge} status=${invoice.status} issues=${result.issues.length} />
      ${files.pdf ? html`<${LinkButton} icon="download" href=${fileUrl("pdf", true)}>${t("det.pdf")}<//>` : null}
      ${files.xml ? html`<${LinkButton} icon="download" href=${fileUrl("xml", true)}>${t("det.xml")}<//>` : null}
      <${Button} icon="refresh" loading=${checking} onClick=${recheck}>${checking ? t("det.validating") : t("det.validate")}<//>
      <${Button} variant="danger" icon="trash" onClick=${() => setConfirming(true)}>${t("det.delete")}<//>
    <//>

    <${ResultBox}
      ok=${result.valid}
      title=${result.valid ? t("det.valid.title") : tn("det.invalid.title", result.issues.length || 1)}
      text=${result.valid ? t("det.valid.text") : t("det.invalid.text")}
    >
      <div class="small muted right">
        ${result.checkedAt ? html`<div>${t("det.checkedAt", { when: fmt.ago(result.checkedAt) })}</div>` : null}
        <div>${fmt.dateTime(invoice.createdAt)}</div>
      </div>
    <//>

    ${result.emailQueued ? html`<${Banner} tone="ok" icon="mail">${t("det.emailQueued", { to: invoice.sentTo ?? "" })}<//>` : null}
    ${result.issues.length ? html`<${IssueList} issues=${result.issues} />` : null}

    <${Card} flush>
      <${Tabs} tabs=${tabs} value=${tab} onChange=${setTab} />

      ${tab === "document"
        ? html`<iframe class="preview-frame" style=${{ height: "720px" }} title=${t("det.tab.document")} src=${fileUrl("pdf")}></iframe>`
        : null}

      ${tab === "xml"
        ? html`<div style=${{ padding: "16px" }}>
            ${xml === null ? html`<${Loading} />` : html`
              ${xmlCut ? html`<p class="small muted" style=${{ marginBottom: "8px" }}>${t("det.xml.large")}</p>` : null}
              <${CodeBlock} value=${xml} language="xml" />`}
          </div>`
        : null}

      ${tab === "request"
        ? html`<div style=${{ padding: "16px" }} class="stack-sm">
            <p class="small muted">${t("det.request.hint")}</p>
            <${CodeBlock} value=${invoice.payload} />
          </div>`
        : null}

      ${tab === "details"
        ? html`<div style=${{ padding: "20px" }} class="stack">
            <div class="grid grid-2">
              <div>
                <h2 class="card-title" style=${{ marginBottom: "10px" }}>${t("det.seller")}</h2>
                <${KeyValues} items=${[
                  [t("cus.name"), invoice.seller.name],
                  [t("cus.street"), invoice.seller.street],
                  [t("cus.city"), `${invoice.seller.zip} ${invoice.seller.city}`],
                  [t("cus.vatId"), invoice.seller.vatId],
                  [t("set.iban"), invoice.seller.iban],
                  [t("cus.email"), invoice.seller.email],
                ]} />
              </div>
              <div>
                <h2 class="card-title" style=${{ marginBottom: "10px" }}>${t("det.buyer")}</h2>
                <${KeyValues} items=${[
                  [t("cus.name"), invoice.buyer.name],
                  [t("cus.street"), invoice.buyer.street],
                  [t("cus.city"), `${invoice.buyer.zip} ${invoice.buyer.city}`],
                  [t("cus.vatId"), invoice.buyer.vatId],
                  [t("new.buyerReference"), invoice.buyerReference],
                  [t("cus.email"), invoice.buyer.email],
                ]} />
              </div>
            </div>
            <div>
              <h2 class="card-title" style=${{ marginBottom: "10px" }}>${t("det.lines")}</h2>
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>${t("new.line.description")}</th>
                      <th class="num">${t("new.line.qty")}</th>
                      <th class="num">${t("new.line.price")}</th>
                      <th class="num">${t("new.line.vat")}</th>
                      <th class="num">${t("new.line.total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${invoice.lines.map(
                      (line, index) => html`<tr key=${index}>
                        <td>${line.description}</td>
                        <td class="num">${fmt.number(line.quantity)} ${unitName(line.unit)}</td>
                        <td class="num">${fmt.money(line.unitPrice)}</td>
                        <td class="num">${line.vatRate} %</td>
                        <td class="num strong">${fmt.money(invoice.totals.lines[index].net)}</td>
                      </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              <div class="totals" style=${{ marginTop: "14px" }}>
                <div class="totals-row"><span>${t("new.totals.net")}</span><span>${fmt.money(invoice.totals.net)}</span></div>
                ${invoice.totals.breakdown.map(
                  (group) => html`<div class="totals-row" key=${group.rate}>
                    <span>${group.rate === 0 ? t("new.totals.exempt", { base: fmt.money(group.taxable) }) : t("new.totals.vat", { rate: group.rate, base: fmt.money(group.taxable) })}</span>
                    <span>${fmt.money(group.tax)}</span>
                  </div>`,
                )}
                <div class="totals-row totals-total"><span>${t("new.totals.gross")}</span><span>${fmt.money(invoice.totals.gross)}</span></div>
              </div>
            </div>
          </div>`
        : null}

      ${tab === "code"
        ? html`<div style=${{ padding: "16px" }} class="stack-sm">
            <p class="small muted">${t("det.code.text")}</p>
            <${CodeBlock} value=${SNIPPETS[invoice.format]} language="js" />
            <p class="small muted">server/einvoice.js</p>
          </div>`
        : null}
    <//>

    ${confirming
      ? html`<${ConfirmModal}
          title=${t("det.delete")}
          text=${t("det.delete.confirm", { number: invoice.number })}
          confirmLabel=${t("common.delete")}
          busy=${deleting}
          onConfirm=${remove}
          onCancel=${() => setConfirming(false)}
        />`
      : null}
  `
}
