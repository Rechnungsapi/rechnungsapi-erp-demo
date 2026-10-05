import { html, useEffect, useState } from "../vendor/htm-preact.js"
import { api } from "../api.js"
import { useApp } from "../context.js"
import { Icon } from "../icons.js"
import { Badge, Banner, Button, Card, EmptyState, FormatBadge, LinkButton, Loading, PageHeader, StatusBadge } from "../ui.js"

const REGISTER_URL = "https://rechnungsapi.de/register"
const DOCS_URL = "https://rechnungsapi.de/api-docs"

export function DashboardPage() {
  const { t, fmt, config, navigate, errorText } = useApp()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([api.get("/stats"), api.get("/invoices"), api.get("/activity?limit=8")])
      .then(([stats, invoices, activity]) => setData({ stats, invoices, activity }))
      .catch(setError)
  }, [])

  if (error) return html`<${Banner} tone="err" icon="alert">${errorText(error)}<//>`
  if (!data) return html`<${Loading} />`
  const { stats, invoices, activity } = data
  const showOnboarding = !config.tokenConfigured && !config.mock

  const kpis = [
    { icon: "invoice", tone: "", value: stats.invoices, label: t("dash.kpi.invoices") },
    {
      icon: "check",
      tone: "ok",
      value: stats.invoices ? `${Math.round((stats.valid / stats.invoices) * 100)} %` : "–",
      label: `${t("dash.kpi.valid")}${stats.invoices ? ` (${stats.valid}/${stats.invoices})` : ""}`,
    },
    { icon: "euro", tone: "info", value: fmt.money(stats.volume), label: t("dash.kpi.volume") },
    { icon: "upload", tone: "warn", value: stats.incoming, label: t("dash.kpi.incoming") },
  ]

  return html`
    <${PageHeader} title=${t("dash.title")} subtitle=${t("dash.subtitle")}>
      <${LinkButton} variant="primary" icon="plus" href="#/invoices/new">${t("dash.quick.new")}<//>
      <${LinkButton} icon="shield" href="#/incoming">${t("dash.quick.validate")}<//>
      <${LinkButton} icon="sparkles" href="#/incoming">${t("dash.quick.read")}<//>
    <//>

    ${showOnboarding
      ? html`<${Card} title=${t("dash.onboard.title")}>
          <ol class="steps">
            <li>${t("dash.onboard.step1")}</li>
            <li>${t("dash.onboard.step2")}</li>
            <li>${t("dash.onboard.step3")}</li>
          </ol>
          <div class="row" style=${{ marginTop: "16px" }}>
            <${LinkButton} variant="primary" href=${REGISTER_URL} target="_blank" rel="noopener" icon="external">${t("dash.onboard.cta")}<//>
          </div>
        <//>`
      : null}

    <div class="grid grid-4">
      ${kpis.map(
        (kpi) => html`<div class="card kpi" key=${kpi.label}>
          <div class=${`kpi-icon ${kpi.tone}`}><${Icon} name=${kpi.icon} size=${22} /></div>
          <div>
            <div class="kpi-value">${kpi.value}</div>
            <div class="kpi-label">${kpi.label}</div>
          </div>
        </div>`,
      )}
    </div>

    <div class="grid dash">
      <${Card}
        flush
        title=${t("dash.recent")}
        actions=${html`<${LinkButton} size="sm" variant="ghost" href="#/invoices">${t("dash.viewAll")}<//>`}
      >
        ${invoices.length === 0
          ? html`<${EmptyState} icon="invoice" title=${t("dash.none")}>
              <${LinkButton} variant="primary" icon="plus" href="#/invoices/new">${t("dash.quick.new")}<//>
            <//>`
          : html`<div class="table-wrap">
              <table class="table">
                <tbody>
                  ${invoices.slice(0, 6).map(
                    (invoice) => html`<tr key=${invoice.id} class="clickable" onClick=${() => navigate(`/invoices/${invoice.id}`)}>
                      <td>
                        <div class="cell-title">${invoice.number}</div>
                        <div class="small muted">${invoice.buyerName}</div>
                      </td>
                      <td class="hide-narrow"><${FormatBadge} format=${invoice.format} /></td>
                      <td><${StatusBadge} status=${invoice.status} issues=${invoice.issues} /></td>
                      <td class="num strong">${fmt.money(invoice.gross)}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>`}
      <//>

      <${Card} title=${t("dash.hood.title")}>
        <p class="small muted" style=${{ marginBottom: "8px" }}>${t("dash.hood.text")}</p>
        ${activity.length === 0
          ? html`<p class="small muted" style=${{ padding: "14px 0" }}>${t("dash.hood.empty")}</p>`
          : html`<div class="calls">
              ${activity.map(
                (call) => html`<div class="call" key=${call.id}>
                  <${Badge} tone=${call.ok ? "ok" : "err"} icon=${call.ok ? "check" : "cross"}>${call.ok ? "OK" : call.code ?? "error"}<//>
                  <div class="spacer">
                    <code>${call.name}</code>
                    <div class="tiny muted">${fmt.ago(call.at)}</div>
                  </div>
                  <span class="small muted nowrap">${call.ms} ms</span>
                </div>`,
              )}
            </div>`}
        <div style=${{ marginTop: "12px" }}>
          <a class="small" href=${DOCS_URL} target="_blank" rel="noopener">${t("dash.hood.docs")} →</a>
        </div>
      <//>
    </div>
  `
}
