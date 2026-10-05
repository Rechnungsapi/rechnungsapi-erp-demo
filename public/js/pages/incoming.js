import { html, useEffect, useState } from "../vendor/htm-preact.js"
import { UNITS } from "/shared/constants.js"
import { fromGermanDate } from "/shared/dates.js"
import { api, fileToBase64 } from "../api.js"
import { useApp } from "../context.js"
import { Icon } from "../icons.js"
import { Badge, Banner, Button, Card, CodeBlock, ConfirmModal, Dropzone, IssueList, KeyValues, LinkButton, PageHeader, ResultBox } from "../ui.js"

const ACCEPT = ".xml,.pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,application/xml,text/xml,image/png,image/jpeg,image/tiff"

/** Which kinds of file each action accepts. The server checks again. */
const ACTIONS = {
  validate: { kinds: ["xml", "pdf"], icon: "shield" },
  extract: { kinds: ["pdf"], icon: "code" },
  read: { kinds: ["pdf", "png", "jpeg", "tiff"], icon: "sparkles" },
  convert: { kinds: ["pdf", "png", "jpeg", "tiff"], icon: "convert" },
}

/** Works out what a file is from its first bytes, like the server does. */
async function detectKind(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  const text = (from, to) => String.fromCharCode(...head.slice(from, to))
  if (text(0, 5) === "%PDF-") return "pdf"
  if (head[0] === 0x89 && text(1, 4) === "PNG") return "png"
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg"
  if (text(0, 4) === "II*\0" || text(0, 4) === "MM\0*") return "tiff"
  if (new TextDecoder().decode(head).replace(/^﻿/, "").trimStart().startsWith("<")) return "xml"
  return null
}

export function IncomingPage() {
  const { t, tn, fmt, config, toast, errorText } = useApp()
  const [selected, setSelected] = useState(null)
  const [withLines, setWithLines] = useState(true)
  const [running, setRunning] = useState(null)
  const [result, setResult] = useState(null)
  const [failure, setFailure] = useState(null)
  const [history, setHistory] = useState([])
  const [removing, setRemoving] = useState(null)

  const loadHistory = () => api.get("/incoming").then(setHistory).catch(() => {})
  useEffect(() => void loadHistory(), [])

  async function choose(file) {
    setResult(null)
    setFailure(null)
    if (file.size > config.maxUploadMb * 1024 * 1024) {
      setSelected(null)
      return setFailure(t("in.tooLarge", { mb: config.maxUploadMb }))
    }
    const kind = await detectKind(file)
    if (!kind) {
      setSelected(null)
      return setFailure(t("in.unsupported"))
    }
    setSelected({ file, kind })
  }

  async function run(action) {
    setRunning(action)
    setResult(null)
    setFailure(null)
    try {
      const record = await api.post("/incoming", {
        action,
        fileName: selected.file.name,
        fileBase64: await fileToBase64(selected.file),
        withLineItems: withLines,
      })
      setResult(record)
      loadHistory()
    } catch (error) {
      setFailure(errorText(error))
    } finally {
      setRunning(null)
    }
  }

  async function remove() {
    try {
      await api.del(`/incoming/${removing}`)
      if (result?.id === removing) setResult(null)
      setRemoving(null)
      loadHistory()
    } catch (error) {
      setRemoving(null)
      toast(errorText(error), "err")
    }
  }

  return html`
    <${PageHeader} title=${t("in.title")} subtitle=${t("in.subtitle")} />

    <${Card}>
      <div class="stack">
        <${Dropzone} accept=${ACCEPT} disabled=${Boolean(running)} onFile=${choose}>
          <${Icon} name="upload" size=${34} />
          <div class="strong">${t("in.drop.title")}</div>
          <div class="small muted">${t("in.drop.text", { mb: config.maxUploadMb })}</div>
          <span class="btn btn-secondary btn-sm">${selected ? t("in.file.change") : t("in.drop.browse")}</span>
        <//>

        ${failure ? html`<${Banner} tone="err" icon="alert">${failure}<//>` : null}

        ${selected
          ? html`
              <div class="file-card">
                <div class="file-icon"><${Icon} name=${["png", "jpeg", "tiff"].includes(selected.kind) ? "image" : "file"} size=${22} /></div>
                <div class="spacer" style=${{ minWidth: 0 }}>
                  <div class="strong" style=${{ overflowWrap: "anywhere" }}>${selected.file.name}</div>
                  <div class="small muted">${t(`in.type.${selected.kind}`)} · ${fmt.bytes(selected.file.size)}</div>
                </div>
              </div>

              <div>
                <div class="strong" style=${{ marginBottom: "10px" }}>${t("in.choose")}</div>
                <div class="choices">
                  ${Object.entries(ACTIONS).map(([action, info]) => {
                    const possible = info.kinds.includes(selected.kind)
                    return html`<button
                      key=${action}
                      type="button"
                      class="choice"
                      disabled=${!possible || Boolean(running)}
                      style=${possible ? undefined : { opacity: 0.45, cursor: "not-allowed" }}
                      onClick=${() => run(action)}
                    >
                      <span class="choice-title">
                        ${running === action ? html`<span class="spinner" aria-hidden="true"></span>` : html`<${Icon} name=${info.icon} />`}
                        ${t(`in.action.${action}`)}
                      </span>
                      <span class="small muted">${running === action ? t("in.running") : t(`in.action.${action}.desc`)}</span>
                    </button>`
                  })}
                </div>
                ${selected.kind !== "xml"
                  ? html`<label class="checkbox-row" style=${{ marginTop: "12px" }}>
                      <input type="checkbox" checked=${withLines} onChange=${(event) => setWithLines(event.target.checked)} />
                      <span class="small">${t("in.withLines")}</span>
                    </label>`
                  : null}
              </div>`
          : null}
      </div>
    <//>

    ${result ? html`<${ResultView} record=${result} />` : null}

    <${Card} flush title=${t("in.history")}>
      ${history.length === 0
        ? html`<p class="small muted" style=${{ padding: "18px 20px" }}>${t("in.history.empty")}</p>`
        : html`<div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>${t("in.col.when")}</th><th>${t("in.col.file")}</th><th>${t("in.col.action")}</th><th>${t("in.col.result")}</th><th><span class="sr-only">${t("common.actions")}</span></th></tr>
              </thead>
              <tbody>
                ${history.map(
                  (record) => html`<tr key=${record.id} class="clickable" onClick=${() => setResult(record)}>
                    <td class="nowrap small muted">${fmt.ago(record.createdAt)}</td>
                    <td style=${{ overflowWrap: "anywhere" }}>${record.fileName}</td>
                    <td>${t(`in.action.${record.action}`)}</td>
                    <td><${Badge} tone=${record.ok ? "ok" : "warn"} icon=${record.ok ? "check" : "alert"}>${record.ok ? t("in.result.ok") : t("in.result.fail")}<//></td>
                    <td class="right">
                      <${Button}
                        variant="ghost"
                        size="sm"
                        aria-label=${t("common.delete")}
                        onClick=${(event) => { event.stopPropagation(); setRemoving(record.id) }}
                      ><${Icon} name="trash" size=${15} /><//>
                    </td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>`}
    <//>

    ${removing
      ? html`<${ConfirmModal} title=${t("common.delete")} text=${t("in.delete.confirm")} confirmLabel=${t("common.delete")} onConfirm=${remove} onCancel=${() => setRemoving(null)} />`
      : null}
  `
}

// --- Results -----------------------------------------------------------------------------------------------

function ResultView({ record }) {
  if (record.action === "validate") return html`<${ValidateResult} record=${record} />`
  if (record.action === "convert") return html`<${ConvertResult} record=${record} />`
  return html`<${DataResult} record=${record} />`
}

function ValidateResult({ record }) {
  const { t, tn } = useApp()
  const { valid, issues = [] } = record.data
  return html`<${Card} title=${record.fileName}>
    <div class="stack-sm">
      <${ResultBox}
        ok=${valid}
        title=${valid ? t("in.valid.title") : tn("in.invalid.title", issues.length || 1)}
        text=${valid ? t("in.valid.text") : t("in.invalid.text")}
      />
      ${issues.length ? html`<${IssueList} issues=${issues} />` : null}
    </div>
  <//>`
}

function ConvertResult({ record }) {
  const { t } = useApp()
  const { data } = record
  if (!record.ok) {
    return html`<${Card} title=${record.fileName}>
      <div class="stack-sm">
        <${ResultBox} ok=${false} title=${t("in.convert.fail.title")} text=${data.message} />
        ${data.rules?.length
          ? html`<div class="row"><span class="small muted">${t("in.convert.rules")}:</span>${data.rules.map((rule) => html`<span key=${rule} class="issue-rule">${rule}</span>`)}</div>`
          : null}
        ${data.reference ? html`<p class="small muted">${t("in.convert.reference", { reference: data.reference })}</p>` : null}
      </div>
    <//>`
  }
  const url = `/api/incoming/${record.id}/file`
  return html`<${Card} title=${record.fileName}>
    <div class="stack-sm">
      <${ResultBox} ok=${true} title=${t("in.convert.ok.title")} text=${t("in.convert.ok.text")}>
        <${LinkButton} variant="primary" icon="download" href=${`${url}?download=1`}>${t("in.download")}<//>
      <//>
      ${data.reference ? html`<p class="small muted">${t("in.convert.reference", { reference: data.reference })}</p>` : null}
      ${record.hasFile ? html`<iframe class="preview-frame" style=${{ height: "560px", borderRadius: "10px" }} title=${record.fileName} src=${url}></iframe>` : null}
    </div>
  <//>`
}

/** The result of "read embedded data" and "read with AI": the key data, the items and everything. */
function DataResult({ record }) {
  const { t, fmt } = useApp()
  const [all, setAll] = useState(false)
  const invoice = record.data.invoice ?? {}
  const confidence = record.data.confidence
  const totals = invoice.documentTotals ?? {}
  const date = (value) => (value ? fmt.date(fromGermanDate(value)) : undefined)
  const money = (value) => (value === undefined ? undefined : fmt.money(value))
  const lines = invoice.invoiceLine ?? []
  const unitName = (code) => UNITS.find((unit) => unit.code === code)?.en ?? code

  return html`<${Card} title=${record.action === "extract" ? t("in.extract.title") : t("in.read.title")}>
    <div class="stack">
      ${confidence !== undefined
        ? html`<div class="stack-sm">
            <div class="row-between">
              <span class="strong">${t("in.confidence")}</span>
              <span class="strong">${confidence} / 100</span>
            </div>
            <div class="meter" role="meter" aria-label=${t("in.confidence")} aria-valuenow=${confidence} aria-valuemin="0" aria-valuemax="100">
              <div class=${`meter-bar ${confidence < 70 ? "low" : confidence < 85 ? "mid" : ""}`} style=${{ width: `${Math.min(confidence, 100)}%` }}></div>
            </div>
            <p class="small muted">${confidence < 70 ? t("in.confidence.low") : t("in.confidence.ok")}</p>
          </div>`
        : null}

      <div class="grid grid-2">
        <${KeyValues} items=${[
          [t("in.field.number"), invoice.invoiceNumber],
          [t("in.field.date"), date(invoice.invoiceIssueDate)],
          [t("in.field.due"), date(invoice.paymentDueDate)],
          [t("in.field.reference"), invoice.buyerReference],
          [t("in.field.seller"), invoice.seller?.sellerName],
          [t("in.field.sellerVat"), invoice.seller?.sellerVatIdentifier],
          [t("in.field.buyer"), invoice.buyer?.buyerName],
          [t("in.field.iban"), invoice.paymentInstructions?.creditTransfer?.[0]?.paymentAccountIdentifier],
        ]} />
        <${KeyValues} items=${[
          [t("in.field.net"), money(totals.invoiceTotalAmountWithoutVat)],
          [t("in.field.vat"), money(totals.invoiceTotalVatAmount)],
          [t("in.field.gross"), money(totals.invoiceTotalAmountWithVat)],
        ]} />
      </div>

      ${lines.length
        ? html`<div>
            <div class="strong" style=${{ marginBottom: "8px" }}>${t("in.lines")}</div>
            <div class="table-wrap card">
              <table class="table">
                <thead>
                  <tr>
                    <th>${t("new.line.description")}</th>
                    <th class="num">${t("new.line.qty")}</th>
                    <th class="num">${t("new.line.price")}</th>
                    <th class="num">${t("new.line.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  ${lines.map(
                    (line, index) => html`<tr key=${index}>
                      <td>${line.itemInformation?.itemName}</td>
                      <td class="num">${fmt.number(line.invoicedQuantity)} ${unitName(line.invoicedQuantityUnitOfMeasureCode)}</td>
                      <td class="num">${money(line.priceDetails?.itemNetPrice)}</td>
                      <td class="num strong">${money(line.invoiceLineNetAmount)}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>
          </div>`
        : null}

      <div class="stack-sm">
        <div><${Button} size="sm" icon=${all ? "x" : "code"} onClick=${() => setAll(!all)}>${t("in.json")}: ${all ? t("common.hide") : t("common.show")}<//></div>
        ${all ? html`<${CodeBlock} value=${invoice} />` : null}
      </div>
    </div>
  <//>`
}
