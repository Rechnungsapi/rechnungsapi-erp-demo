import { html, useEffect, useState } from "../vendor/htm-preact.js"
import { api } from "../api.js"
import { useApp } from "../context.js"
import { Banner, Card, EmptyState, FormatBadge, Input, LinkButton, Loading, PageHeader, Select, StatusBadge } from "../ui.js"

export function InvoicesPage() {
  const { t, fmt, navigate, errorText } = useApp()
  const [invoices, setInvoices] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState("")
  const [format, setFormat] = useState("")
  const [status, setStatus] = useState("")
  const filtered = Boolean(q || format || status)

  useEffect(() => {
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ q, format, status }).toString()
      api.get(`/invoices?${query}`).then(setInvoices).catch(setError)
    }, 200)
    return () => clearTimeout(timer)
  }, [q, format, status])

  return html`
    <${PageHeader} title=${t("inv.title")} subtitle=${t("inv.subtitle")}>
      <${LinkButton} variant="primary" icon="plus" href="#/invoices/new">${t("nav.new")}<//>
    <//>

    ${error ? html`<${Banner} tone="err" icon="alert">${errorText(error)}<//>` : null}

    <${Card} flush>
      <div class="row" style=${{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style=${{ flex: "1 1 240px" }}>
          <${Input} type="search" placeholder=${t("inv.search")} aria-label=${t("inv.search")} value=${q} onInput=${(event) => setQ(event.target.value)} />
        </div>
        <div style=${{ width: "190px" }}>
          <${Select} aria-label=${t("inv.filter.format")} value=${format} onChange=${(event) => setFormat(event.target.value)}>
            <option value="">${t("inv.filter.format")}: ${t("common.all")}</option>
            <option value="zugferd">${t("format.zugferd")}</option>
            <option value="xrechnung">${t("format.xrechnung")}</option>
          <//>
        </div>
        <div style=${{ width: "190px" }}>
          <${Select} aria-label=${t("inv.filter.status")} value=${status} onChange=${(event) => setStatus(event.target.value)}>
            <option value="">${t("inv.status.all")}</option>
            <option value="valid">${t("inv.status.valid")}</option>
            <option value="invalid">${t("inv.status.issues")}</option>
          <//>
        </div>
      </div>

      ${invoices === null
        ? html`<${Loading} />`
        : invoices.length === 0
          ? html`<${EmptyState}
              icon="invoice"
              title=${filtered ? t("inv.noMatch") : t("inv.empty.title")}
              text=${filtered ? "" : t("inv.empty.text")}
            >
              ${filtered ? null : html`<${LinkButton} variant="primary" icon="plus" href="#/invoices/new">${t("nav.new")}<//>`}
            <//>`
          : html`<div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>${t("inv.col.number")}</th>
                    <th>${t("inv.col.customer")}</th>
                    <th>${t("inv.col.format")}</th>
                    <th>${t("inv.col.status")}</th>
                    <th>${t("inv.col.issued")}</th>
                    <th>${t("inv.col.due")}</th>
                    <th class="num">${t("inv.col.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  ${invoices.map(
                    (invoice) => html`<tr key=${invoice.id} class="clickable" onClick=${() => navigate(`/invoices/${invoice.id}`)}>
                      <td class="cell-title"><a href=${`#/invoices/${invoice.id}`} onClick=${(event) => event.stopPropagation()}>${invoice.number}</a></td>
                      <td>${invoice.buyerName}</td>
                      <td><${FormatBadge} format=${invoice.format} /></td>
                      <td><${StatusBadge} status=${invoice.status} issues=${invoice.issues} /></td>
                      <td class="nowrap">${fmt.date(invoice.issueDate)}</td>
                      <td class="nowrap">${fmt.date(invoice.dueDate)}</td>
                      <td class="num strong">${fmt.money(invoice.gross)}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>`}
    <//>
  `
}
