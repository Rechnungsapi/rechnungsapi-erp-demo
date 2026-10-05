import { html, useEffect, useMemo, useRef, useState } from "../vendor/htm-preact.js"
import { UNITS } from "/shared/constants.js"
import { addDays, isIsoDate, todayIso } from "/shared/dates.js"
import { computeTotals } from "/shared/money.js"
import { api } from "../api.js"
import { useApp } from "../context.js"
import { Icon } from "../icons.js"
import { Banner, Button, Card, CodeBlock, EmptyState, Field, FormatBadge, Input, LinkButton, Loading, PageHeader, Select, Tabs, Textarea } from "../ui.js"

const SELLER_FIELDS = ["name", "street", "zip", "city", "country", "vatId", "email", "phone", "contactName", "iban"]
const BUYER_FIELDS = ["name", "street", "zip", "city", "country", "email"]
const FIELD_LABEL = {
  name: "cus.name", street: "cus.street", zip: "cus.zip", city: "cus.city", country: "cus.country", vatId: "cus.vatId",
  email: "cus.email", phone: "set.phone", contactName: "set.contactName", iban: "set.iban",
}
const EMAIL_DOCS = "https://rechnungsapi.de/docs#email-setup"

let lineKey = 0
const newLine = (vatRate = 19) => ({ key: (lineKey += 1), description: "", quantity: "1", unit: "C62", unitPrice: "", vatRate: String(vatRate) })

function initialForm({ settings, customers, query, t }) {
  const customer = customers.find((item) => item.id === query.customer) ?? customers[0]
  const today = todayIso()
  return {
    format: settings.defaults.format,
    customerId: customer?.id ?? "",
    number: "",
    issueDate: today,
    deliveryDate: "",
    dueDate: addDays(today, settings.defaults.paymentDays),
    buyerReference: customer?.buyerReference ?? "",
    orderReference: "",
    language: settings.defaults.language,
    paymentTerms: "",
    note: "",
    exemptionReason: "",
    lines: [newLine(settings.defaults.vatRate)],
    mail: {
      enabled: false,
      sender: settings.company.email,
      senderName: settings.company.name,
      receiver: customer?.email ?? "",
      cc: "",
      bcc: "",
      subject: t("new.email.defaultSubject"),
      message: t("new.email.defaultMessage"),
    },
  }
}

/** True when the form is complete enough for a preview, so incomplete forms do not cause failed requests. */
function isPreviewable(draft) {
  return (
    Boolean(draft.customerId) &&
    isIsoDate(draft.issueDate) &&
    isIsoDate(draft.dueDate) &&
    draft.lines.length > 0 &&
    draft.lines.every((line) => line.description.trim() !== "" && line.quantity > 0 && line.unitPrice !== "" && line.unitPrice >= 0) &&
    (draft.format !== "xrechnung" || draft.buyerReference.trim() !== "") &&
    (!draft.lines.some((line) => line.vatRate === 0) || draft.exemptionReason.trim() !== "")
  )
}

const asNumber = (value) => (String(value).trim() === "" ? "" : Number(value))

/** What the server expects. Numbers that are not filled in stay empty, so the server can point at them. */
function toDraft(form) {
  return {
    customerId: form.customerId,
    number: form.number || undefined,
    issueDate: form.issueDate,
    dueDate: form.dueDate,
    deliveryDate: form.deliveryDate || undefined,
    format: form.format,
    language: form.language,
    buyerReference: form.buyerReference,
    orderReference: form.orderReference,
    paymentTerms: form.paymentTerms,
    note: form.note,
    exemptionReason: form.exemptionReason,
    lines: form.lines.map((line) => ({
      description: line.description,
      quantity: asNumber(line.quantity),
      unit: line.unit,
      unitPrice: asNumber(line.unitPrice),
      vatRate: Number(line.vatRate),
    })),
    transport: form.mail.enabled ? { ...form.mail } : undefined,
  }
}

export function InvoiceNewPage({ route }) {
  const { t, lang, fmt, navigate, toast, errorText } = useApp()
  const [base, setBase] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [problem, setProblem] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState("pdf")
  const [preview, setPreview] = useState({ status: "idle", url: null, payload: null, number: null })
  const dueTouched = useRef(false)
  const previewUrl = useRef(null)

  useEffect(() => {
    Promise.all([api.get("/settings"), api.get("/customers")])
      .then(([settings, customers]) => {
        setBase({ settings, customers })
        setForm(initialForm({ settings, customers, query: route.query, t }))
      })
      .catch(setLoadError)
    return () => previewUrl.current && URL.revokeObjectURL(previewUrl.current)
  }, [])

  const totals = useMemo(
    () => computeTotals((form?.lines ?? []).map((line) => ({ quantity: Number(line.quantity) || 0, unitPrice: Number(line.unitPrice) || 0, vatRate: Number(line.vatRate) }))),
    [form?.lines],
  )

  // The preview follows the form after a short pause. It costs no API credits.
  const draft = form ? toDraft(form) : null
  const draftKey = JSON.stringify(draft)
  useEffect(() => {
    if (!draft || !base?.customers.length) return undefined
    if (!isPreviewable(draft)) {
      setPreview((current) => ({ ...current, status: "incomplete" }))
      return undefined
    }
    const timer = setTimeout(async () => {
      setPreview((current) => ({ ...current, status: "loading" }))
      try {
        const [meta, pdf] = await Promise.all([api.post("/invoices/preview", draft), draft.format === "zugferd" ? api.post("/invoices/preview-pdf", draft) : null])
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
        previewUrl.current = pdf ? URL.createObjectURL(pdf) : null
        setPreview({ status: "ready", url: previewUrl.current, payload: meta.payload, number: meta.number })
      } catch (error) {
        setPreview((current) => ({ ...current, status: error.code === "validation" ? "incomplete" : "error" }))
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [draftKey])

  if (loadError) return html`<${Banner} tone="err" icon="alert">${errorText(loadError)}<//>`
  if (!form) return html`<${Loading} />`
  const { settings, customers } = base
  if (customers.length === 0) {
    return html`<${EmptyState} icon="users" title=${t("new.noCustomers")}>
      <${LinkButton} variant="primary" href="#/customers">${t("new.customer.manage")}<//>
    <//>`
  }

  const customer = customers.find((item) => item.id === form.customerId)
  const missingSeller = SELLER_FIELDS.filter((field) => !String(settings.company[field] ?? "").trim())
  const missingBuyer = BUYER_FIELDS.filter((field) => !String(customer?.[field] ?? "").trim())
  const labels = (fields) => fields.map((field) => t(FIELD_LABEL[field])).join(", ")
  const hasExempt = form.lines.some((line) => Number(line.vatRate) === 0)

  const set = (name, value) => setForm((current) => ({ ...current, [name]: value }))
  const setMail = (name, value) => setForm((current) => ({ ...current, mail: { ...current.mail, [name]: value } }))
  const setLine = (index, patch) => setForm((current) => ({ ...current, lines: current.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) }))
  const bind = (name) => ({ value: form[name], onInput: (event) => set(name, event.target.value) })
  const bindMail = (name) => ({ value: form.mail[name], onInput: (event) => setMail(name, event.target.value) })
  const bindLine = (index, name) => ({ value: form.lines[index][name], onInput: (event) => setLine(index, { [name]: event.target.value }) })
  const message = (name) => (errors[name] ? t(`err.${errors[name]}`) : undefined)

  const onCustomer = (id) => {
    const next = customers.find((item) => item.id === id)
    setForm((current) => ({ ...current, customerId: id, buyerReference: next?.buyerReference ?? "", mail: { ...current.mail, receiver: next?.email ?? "" } }))
  }
  const onIssueDate = (value) =>
    setForm((current) => ({ ...current, issueDate: value, dueDate: dueTouched.current || !value ? current.dueDate : addDays(value, settings.defaults.paymentDays) }))

  const fillExample = () =>
    setForm((current) => {
      const de = current.language === "de"
      return {
        ...current,
        orderReference: "B-2026-0815",
        note: de ? "Vielen Dank für Ihren Auftrag." : "Thank you for your order.",
        lines: [
          { ...newLine(19), description: de ? "Beratung Softwarearchitektur und Integrationskonzept" : "Software architecture consulting and integration concept", quantity: "12", unit: "HUR", unitPrice: "145" },
          { ...newLine(19), description: de ? "Wartungsvertrag, Q4/2026" : "Maintenance contract, Q4/2026", quantity: "3", unit: "MON", unitPrice: "89.90" },
          { ...newLine(7), description: de ? "Fachbuch „E-Rechnung in der Praxis“" : "Book: e-invoicing in practice", quantity: "2", unit: "C62", unitPrice: "29.50" },
        ],
      }
    })

  async function submit(event) {
    event.preventDefault()
    setErrors({})
    setProblem(null)
    setSubmitting(true)
    try {
      const created = await api.post("/invoices", draft)
      toast(t("new.created", { number: created.number }))
      navigate(`/invoices/${created.id}`)
    } catch (error) {
      if (error.code === "validation") {
        setErrors(error.body.fields ?? {})
        toast(t("new.fixErrors"), "err")
        setTimeout(() => document.querySelector('[aria-invalid="true"]')?.focus(), 50)
      } else if (error.code === "missing_fields") {
        setProblem({ missing: error.body.missing ?? [] })
      } else {
        toast(errorText(error), "err")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const blocked = missingSeller.length > 0 || missingBuyer.length > 0

  return html`
    <${PageHeader} title=${t("new.title")} subtitle=${t("new.subtitle")}>
      <${Button} icon="sparkles" onClick=${fillExample}>${t("new.example")}<//>
    <//>

    ${missingSeller.length
      ? html`<${Banner} tone="warn" icon="alert">
          ${t("new.sellerIncomplete", { fields: labels(missingSeller) })} <a href="#/settings">${t("new.sellerIncomplete.cta")}</a>
        <//>`
      : null}
    ${missingBuyer.length
      ? html`<${Banner} tone="warn" icon="alert">
          ${t("new.customerIncomplete", { fields: labels(missingBuyer) })} <a href="#/customers">${t("new.customerIncomplete.cta")}</a>
        <//>`
      : null}

    <form class="create" onSubmit=${submit} noValidate>
      <div class="stack">
        <${Card} title=${t("new.section.format")}>
          <div class="choices" role="radiogroup">
            ${["zugferd", "xrechnung"].map(
              (format) => html`<button
                key=${format}
                type="button"
                class="choice"
                role="radio"
                aria-checked=${form.format === format ? "true" : "false"}
                onClick=${() => set("format", format)}
              >
                <span class="choice-title"><${Icon} name=${format === "zugferd" ? "invoice" : "code"} />${t(`format.${format}`)}</span>
                <span class="small muted">${t(`format.${format}.desc`)}</span>
              </button>`,
            )}
          </div>
        <//>

        <${Card} title=${t("new.section.customer")} actions=${html`<a class="small" href="#/customers">${t("new.customer.manage")}</a>`}>
          <div class="stack-sm">
            <${Field} label=${t("new.customer")} error=${message("customerId")}>
              ${(control) => html`<${Select} ...${control} value=${form.customerId} onChange=${(event) => onCustomer(event.target.value)}>
                ${customers.map((item) => html`<option key=${item.id} value=${item.id}>${item.name}</option>`)}
              <//>`}
            <//>
            ${customer
              ? html`<div class="small muted">${customer.street}, ${customer.zip} ${customer.city}${customer.vatId ? ` · ${customer.vatId}` : ""} · ${customer.email}</div>`
              : null}
          </div>
        <//>

        <${Card} title=${t("new.section.details")}>
          <div class="grid grid-2">
            <${Field} label=${t("new.number")} hint=${t("new.number.hint", { next: preview.number ?? "…" })} error=${message("number")}>
              ${(control) => html`<${Input} ...${control} ...${bind("number")} placeholder=${preview.number ?? ""} />`}
            <//>
            <${Field} label=${t("new.pdfLanguage")}>
              ${(control) => html`<${Select} ...${control} ...${bind("language")} onChange=${(event) => set("language", event.target.value)}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              <//>`}
            <//>
            <${Field} label=${t("new.issueDate")} required error=${message("issueDate")}>
              ${(control) => html`<${Input} type="date" ...${control} value=${form.issueDate} onInput=${(event) => onIssueDate(event.target.value)} />`}
            <//>
            <${Field} label=${t("new.dueDate")} required error=${message("dueDate")}>
              ${(control) => html`<${Input}
                type="date"
                ...${control}
                value=${form.dueDate}
                onInput=${(event) => {
                  dueTouched.current = true
                  set("dueDate", event.target.value)
                }}
              />`}
            <//>
            <${Field} label=${t("new.deliveryDate")} error=${message("deliveryDate")}>
              ${(control) => html`<${Input} type="date" ...${control} ...${bind("deliveryDate")} />`}
            <//>
            <${Field} label=${t("new.orderReference")} error=${message("orderReference")}>
              ${(control) => html`<${Input} ...${control} ...${bind("orderReference")} />`}
            <//>
            <${Field} class="span-all" label=${t("new.buyerReference")} required=${form.format === "xrechnung"} hint=${t("new.buyerReference.hint")} error=${message("buyerReference")}>
              ${(control) => html`<${Input} ...${control} ...${bind("buyerReference")} />`}
            <//>
          </div>
        <//>

        <${Card} title=${t("new.section.lines")}>
          <div class="lines">
            ${form.lines.map(
              (line, index) => html`<div class="line" key=${line.key}>
                <${Field} class="line-desc" label=${t("new.line.description")} error=${message(`lines.${index}.description`)}>
                  ${(control) => html`<${Input} ...${control} ...${bindLine(index, "description")} />`}
                <//>
                <${Field} label=${t("new.line.qty")} error=${message(`lines.${index}.quantity`)}>
                  ${(control) => html`<${Input} type="number" step="any" min="0" inputmode="decimal" ...${control} ...${bindLine(index, "quantity")} />`}
                <//>
                <${Field} label=${t("new.line.unit")}>
                  ${(control) => html`<${Select} ...${control} value=${line.unit} onChange=${(event) => setLine(index, { unit: event.target.value })}>
                    ${UNITS.map((unit) => html`<option key=${unit.code} value=${unit.code}>${unit[lang]}</option>`)}
                  <//>`}
                <//>
                <${Field} label=${t("new.line.price")} error=${message(`lines.${index}.unitPrice`)}>
                  ${(control) => html`<${Input} type="number" step="any" min="0" inputmode="decimal" placeholder="0,00" ...${control} ...${bindLine(index, "unitPrice")} />`}
                <//>
                <${Field} label=${t("new.line.vat")} error=${message(`lines.${index}.vatRate`)}>
                  ${(control) => html`<${Select} ...${control} value=${line.vatRate} onChange=${(event) => setLine(index, { vatRate: event.target.value })}>
                    <option value="19">19 %</option>
                    <option value="7">7 %</option>
                    <option value="0">${t("new.vat.exempt")}</option>
                  <//>`}
                <//>
                <div class="field">
                  <span class="label">${t("new.line.total")}</span>
                  <div class="line-total">${fmt.money(totals.lines[index]?.net ?? 0)}</div>
                </div>
                <${Button}
                  class="line-remove"
                  variant="ghost"
                  size="sm"
                  aria-label=${t("new.line.remove")}
                  title=${t("new.line.remove")}
                  disabled=${form.lines.length === 1}
                  onClick=${() => set("lines", form.lines.filter((_, at) => at !== index))}
                ><${Icon} name="trash" size=${16} /><//>
              </div>`,
            )}
          </div>
          ${message("lines") ? html`<p class="error-text" role="alert">${message("lines")}</p>` : null}
          <div class="row-between" style=${{ marginTop: "12px" }}>
            <${Button} icon="plus" onClick=${() => set("lines", [...form.lines, newLine(settings.defaults.vatRate)])}>${t("new.line.add")}<//>
            <div class="totals">
              <div class="totals-row"><span>${t("new.totals.net")}</span><span>${fmt.money(totals.net)}</span></div>
              ${totals.breakdown.map(
                (group) => html`<div class="totals-row" key=${group.rate}>
                  <span>${group.rate === 0 ? t("new.totals.exempt", { base: fmt.money(group.taxable) }) : t("new.totals.vat", { rate: group.rate, base: fmt.money(group.taxable) })}</span>
                  <span>${fmt.money(group.tax)}</span>
                </div>`,
              )}
              <div class="totals-row totals-total"><span>${t("new.totals.gross")}</span><span>${fmt.money(totals.gross)}</span></div>
            </div>
          </div>
        <//>

        <${Card} title=${t("new.section.text")}>
          <div class="stack-sm">
            <${Field} label=${t("new.paymentTerms")} hint=${t("new.paymentTerms.hint")} error=${message("paymentTerms")}>
              ${(control) => html`<${Textarea} rows="2" ...${control} ...${bind("paymentTerms")} />`}
            <//>
            <${Field} label=${t("new.note")} error=${message("note")}>
              ${(control) => html`<${Textarea} rows="2" ...${control} ...${bind("note")} />`}
            <//>
            ${hasExempt
              ? html`<${Field} label=${t("new.exemption")} required hint=${t("new.exemption.hint")} error=${message("exemptionReason")}>
                  ${(control) => html`<${Input} ...${control} ...${bind("exemptionReason")} />`}
                <//>`
              : null}
          </div>
        <//>

        <${Card} title=${t("new.section.email")}>
          <div class="stack-sm">
            <label class="checkbox-row">
              <input type="checkbox" checked=${form.mail.enabled} onChange=${(event) => setMail("enabled", event.target.checked)} />
              <span class="strong">${t("new.email.enable")}</span>
            </label>
            <p class="small muted">${t("new.email.hint")} <a href=${EMAIL_DOCS} target="_blank" rel="noopener">${t("new.email.docs")}</a></p>
            ${form.mail.enabled
              ? html`<div class="grid grid-2">
                  <${Field} label=${t("new.email.sender")} required error=${message("transport.sender")}>
                    ${(control) => html`<${Input} type="email" ...${control} ...${bindMail("sender")} />`}
                  <//>
                  <${Field} label=${t("new.email.senderName")} error=${message("transport.senderName")}>
                    ${(control) => html`<${Input} ...${control} ...${bindMail("senderName")} />`}
                  <//>
                  <${Field} class="span-all" label=${t("new.email.receiver")} required error=${message("transport.receiver")}>
                    ${(control) => html`<${Input} ...${control} ...${bindMail("receiver")} />`}
                  <//>
                  <${Field} label=${t("new.email.cc")} error=${message("transport.cc")}>
                    ${(control) => html`<${Input} ...${control} ...${bindMail("cc")} />`}
                  <//>
                  <${Field} label=${t("new.email.bcc")} error=${message("transport.bcc")}>
                    ${(control) => html`<${Input} ...${control} ...${bindMail("bcc")} />`}
                  <//>
                  <${Field} class="span-all" label=${t("new.email.subject")} required error=${message("transport.subject")}>
                    ${(control) => html`<${Input} ...${control} ...${bindMail("subject")} />`}
                  <//>
                  <${Field} class="span-all" label=${t("new.email.message")} required error=${message("transport.message")}>
                    ${(control) => html`<${Textarea} rows="4" ...${control} ...${bindMail("message")} />`}
                  <//>
                </div>`
              : null}
          </div>
        <//>

        ${problem
          ? html`<${Banner} tone="err" icon="alert">
              <strong>${t("new.missingFields")}</strong>
              <ul class="small" style=${{ margin: "6px 0 0", paddingLeft: "18px" }}>
                ${problem.missing.map((item, index) => html`<li key=${index}><code>${item.rule}</code> ${item.message}</li>`)}
              </ul>
            <//>`
          : null}

        <div class="actionbar">
          <div class="row">
            <${FormatBadge} format=${form.format} />
            <span class="strong">${t("new.totals.gross")}: ${fmt.money(totals.gross)}</span>
          </div>
          <${Button} type="submit" variant="primary" size="lg" icon=${submitting ? undefined : "bolt"} loading=${submitting} disabled=${blocked}>
            ${submitting ? t("new.creating") : form.format === "zugferd" ? t("new.create.zugferd") : t("new.create.xrechnung")}
          <//>
        </div>
      </div>

      <aside class="side stack">
        <${Card} flush>
          <${Tabs}
            tabs=${[{ id: "pdf", label: t("new.preview.pdf") }, { id: "json", label: t("new.preview.json") }]}
            value=${tab}
            onChange=${setTab}
          />
          ${tab === "pdf"
            ? form.format === "xrechnung"
              ? html`<div class="preview-empty"><div class="stack-sm"><p>${t("new.preview.xrechnung")}</p><div><${Button} onClick=${() => setTab("json")}>${t("new.preview.json")}<//></div></div></div>`
              : preview.url
                ? html`<iframe class="preview-frame" title=${t("new.preview.pdf")} src=${`${preview.url}#toolbar=0&navpanes=0&view=FitH`}></iframe>`
                : html`<div class="preview-empty">${preview.status === "loading" ? t("common.loading") : t("new.preview.hint")}</div>`
            : preview.payload
              ? html`<div style=${{ padding: "14px" }}><${CodeBlock} value=${preview.payload} /></div>`
              : html`<div class="preview-empty">${t("new.preview.hint")}</div>`}
          <div class="small muted" style=${{ padding: "10px 16px 14px", borderTop: "1px solid var(--border)" }}>${t("new.preview.free")}</div>
        <//>
      </aside>
    </form>
  `
}
