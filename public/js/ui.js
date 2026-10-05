import { html, useEffect, useMemo, useRef, useState } from "./vendor/htm-preact.js"
import { clip, formatXml, highlightJs, highlightJson, highlightXml } from "./code.js"
import { useApp } from "./context.js"
import { Icon } from "./icons.js"

// The building blocks of the UI: buttons, fields, dialogs, tabs, code blocks and so on.

const classes = (...names) => names.filter(Boolean).join(" ")

export function Button({ variant = "secondary", size, loading = false, icon, children, class: className, disabled, type = "button", ...rest }) {
  return html`<button
    type=${type}
    class=${classes("btn", `btn-${variant}`, size && `btn-${size}`, className)}
    disabled=${disabled || loading}
    ...${rest}
  >
    ${loading ? html`<span class="spinner" aria-hidden="true"></span>` : icon ? html`<${Icon} name=${icon} size=${size === "sm" ? 15 : 17} />` : null}
    ${children}
  </button>`
}

/** A link that looks like a button. */
export function LinkButton({ variant = "secondary", size, icon, children, class: className, ...rest }) {
  return html`<a class=${classes("btn", `btn-${variant}`, size && `btn-${size}`, className)} ...${rest}>
    ${icon ? html`<${Icon} name=${icon} size=${size === "sm" ? 15 : 17} />` : null}
    ${children}
  </a>`
}

export const Badge = ({ tone = "neutral", children, icon }) =>
  html`<span class=${classes("badge", tone !== "neutral" && `badge-${tone}`)}>${icon ? html`<${Icon} name=${icon} size=${13} />` : null}${children}</span>`

export function FormatBadge({ format }) {
  const { t } = useApp()
  return html`<${Badge} tone=${format === "zugferd" ? "brand" : "info"}>${t(`format.${format}`)}<//>`
}

export function StatusBadge({ status, issues = 0 }) {
  const { t, tn } = useApp()
  return status === "valid"
    ? html`<${Badge} tone="ok" icon="check">${t("inv.status.valid")}<//>`
    : html`<${Badge} tone="warn" icon="alert">${tn("inv.status.invalid", issues || 1)}<//>`
}

export function Card({ title, actions, flush = false, class: className, children }) {
  return html`<section class=${classes("card", flush && "card-flush", className)}>
    ${title || actions ? html`<div class="card-header"><h2 class="card-title">${title}</h2><div class="row">${actions}</div></div>` : null}
    <div class="card-body">${children}</div>
  </section>`
}

export function PageHeader({ title, subtitle, children }) {
  return html`<header class="page-header">
    <div>
      <h1 class="page-title">${title}</h1>
      ${subtitle ? html`<p class="page-sub">${subtitle}</p>` : null}
    </div>
    <div class="row">${children}</div>
  </header>`
}

let fieldCounter = 0

/**
 * A labelled form field. Give it a function as its child to receive the props the control needs:
 *   <${Field} label="Name" error=${...}>${(control) => html`<input ...${control} />`}<//>
 */
export function Field({ label, error, hint, required = false, class: className, children }) {
  const id = useMemo(() => `field-${(fieldCounter += 1)}`, [])
  const control = { id, "aria-invalid": error ? "true" : undefined, "aria-describedby": error || hint ? `${id}-note` : undefined, invalid: Boolean(error) }
  const render = Array.isArray(children) ? children[0] : children
  return html`<div class=${classes("field", className)}>
    <label class="label" for=${id}>${label}${required ? html`<span class="req" aria-hidden="true"> *</span>` : null}</label>
    ${typeof render === "function" ? render(control) : render}
    ${error ? html`<span id=${`${id}-note`} class="error-text" role="alert">${error}</span>` : hint ? html`<span id=${`${id}-note`} class="hint">${hint}</span>` : null}
  </div>`
}

export const Input = ({ invalid, class: className, ...rest }) => html`<input class=${classes("input", invalid && "invalid", className)} ...${rest} />`
export const Select = ({ invalid, class: className, children, ...rest }) =>
  html`<select class=${classes("select", invalid && "invalid", className)} ...${rest}>${children}</select>`
export const Textarea = ({ invalid, class: className, ...rest }) => html`<textarea class=${classes("textarea", invalid && "invalid", className)} ...${rest}></textarea>`

export function Banner({ tone = "info", icon = "info", children }) {
  return html`<div class=${classes("banner", `banner-${tone}`)} role=${tone === "err" ? "alert" : "status"}>
    <${Icon} name=${icon} size=${18} />
    <div>${children}</div>
  </div>`
}

export const EmptyState = ({ icon = "file", title, text, children }) =>
  html`<div class="empty">
    <${Icon} name=${icon} size=${36} />
    <div class="strong">${title}</div>
    ${text ? html`<p class="small">${text}</p>` : null}
    ${children}
  </div>`

export const Loading = () => {
  const { t } = useApp()
  return html`<div class="loading" role="status">${t("common.loading")}</div>`
}

// --- Dialogs ---------------------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, children, footer, width }) {
  const { t } = useApp()
  const dialog = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.querySelector(FOCUSABLE)?.focus()
    return () => previous?.focus?.()
  }, [])

  const onKeyDown = (event) => {
    if (event.key === "Escape") return onClose()
    if (event.key !== "Tab") return
    const items = [...dialog.current.querySelectorAll(FOCUSABLE)]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) (event.preventDefault(), last.focus())
    else if (!event.shiftKey && document.activeElement === last) (event.preventDefault(), first.focus())
  }

  return html`<div class="modal-backdrop" onMouseDown=${(event) => event.target === event.currentTarget && onClose()}>
    <div ref=${dialog} class="modal" style=${width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-modal="true" aria-label=${title} onKeyDown=${onKeyDown}>
      <div class="modal-header">
        <h2 class="card-title">${title}</h2>
        <button type="button" class="btn btn-ghost btn-sm" aria-label=${t("common.close")} onClick=${onClose}><${Icon} name="x" /></button>
      </div>
      <div class="modal-body">${children}</div>
      ${footer ? html`<div class="modal-footer">${footer}</div>` : null}
    </div>
  </div>`
}

export function ConfirmModal({ title, text, confirmLabel, danger = true, busy = false, onConfirm, onCancel }) {
  const { t } = useApp()
  return html`<${Modal}
    title=${title}
    onClose=${onCancel}
    width=${460}
    footer=${html`
      <${Button} onClick=${onCancel}>${t("common.cancel")}<//>
      <${Button} variant=${danger ? "danger" : "primary"} loading=${busy} onClick=${onConfirm}>${confirmLabel}<//>
    `}
  >
    <p>${text}</p>
  <//>`
}

export function Toasts({ toasts }) {
  return html`<div class="toasts" aria-live="polite">
    ${toasts.map((toast) => html`<div key=${toast.id} class=${classes("toast", `toast-${toast.tone}`)}>
      <${Icon} name=${toast.tone === "err" ? "alert" : "check"} />
      <span>${toast.message}</span>
    </div>`)}
  </div>`
}

// --- Navigation inside a page -------------------------------------------------------------------------

export function Tabs({ tabs, value, onChange }) {
  return html`<div class="tabs" role="tablist">
    ${tabs.map(
      (tab) => html`<button
        key=${tab.id}
        type="button"
        role="tab"
        class="tab"
        aria-selected=${tab.id === value ? "true" : "false"}
        onClick=${() => onChange(tab.id)}
      >${tab.label}</button>`,
    )}
  </div>`
}

// --- Files -------------------------------------------------------------------------------------------------

export function Dropzone({ onFile, accept, disabled = false, children }) {
  const [over, setOver] = useState(false)
  const input = useRef(null)
  const pick = () => !disabled && input.current?.click()

  return html`<div
    class=${classes("dropzone", over && "over")}
    role="button"
    tabindex="0"
    aria-disabled=${disabled ? "true" : undefined}
    onClick=${pick}
    onKeyDown=${(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), pick())}
    onDragOver=${(event) => (event.preventDefault(), setOver(true))}
    onDragLeave=${() => setOver(false)}
    onDrop=${(event) => {
      event.preventDefault()
      setOver(false)
      const file = event.dataTransfer?.files?.[0]
      if (file && !disabled) onFile(file)
    }}
  >
    ${children}
    <input
      ref=${input}
      class="hidden"
      type="file"
      accept=${accept}
      tabindex="-1"
      onClick=${(event) => event.stopPropagation()}
      onChange=${(event) => {
        const file = event.target.files?.[0]
        if (file) onFile(file)
        event.target.value = ""
      }}
    />
  </div>`
}

// --- Code ---------------------------------------------------------------------------------------------------

/** Shows JSON, XML or JavaScript with colors and a copy button. @param {{ value: any, language?: "json"|"xml"|"js" }} props */
export function CodeBlock({ value, language = "json" }) {
  const { t } = useApp()
  const [copied, setCopied] = useState(false)

  const source = useMemo(() => {
    const text = language === "json" ? JSON.stringify(value, null, 2) : language === "xml" ? formatXml(String(value)) : String(value)
    return clip(text)
  }, [value, language])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be refused; selecting the text by hand still works.
    }
  }

  return html`<div class="code">
    <${Button} class="copy" size="sm" icon=${copied ? "check" : "copy"} onClick=${copy}>${copied ? t("common.copied") : t("common.copy")}<//>
    <pre><code>${language === "json" ? highlightJson(source.text) : language === "xml" ? highlightXml(source.text) : highlightJs(source.text)}</code></pre>
  </div>`
}

/** True when CodeBlock would cut the text because it is very long. */
export function useSourceTruncated(value, language) {
  return useMemo(() => clip(language === "json" ? JSON.stringify(value, null, 2) : language === "xml" ? formatXml(String(value)) : String(value)).truncated, [value, language])
}

// --- Validation findings ----------------------------------------------------------------------------------

export function IssueList({ issues }) {
  return html`<div class="issues">
    ${issues.map(
      (issue, index) => html`<div key=${index} class=${classes("issue", issue.severity)}>
        ${issue.rule ? html`<span class="issue-rule">${issue.rule}</span>` : null}
        <div>
          <div class="issue-msg">${issue.message}</div>
          ${issue.location ? html`<div class="issue-loc">${issue.location}</div>` : null}
        </div>
      </div>`,
    )}
  </div>`
}

/** The big green or red box that says whether a document passed. */
export function ResultBox({ ok, title, text, children }) {
  return html`<div class=${classes("result", !ok && "bad")}>
    <div class="result-mark"><${Icon} name=${ok ? "check" : "alert"} size=${26} /></div>
    <div class="spacer">
      <div class="result-title">${title}</div>
      ${text ? html`<div class="small">${text}</div>` : null}
    </div>
    ${children}
  </div>`
}

export const KeyValues = ({ items }) =>
  html`<dl class="kv">
    ${items.filter((item) => item[1] !== undefined && item[1] !== "").map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}
  </dl>`
