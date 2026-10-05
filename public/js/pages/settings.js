import { html, useEffect, useState } from "../vendor/htm-preact.js"
import { COUNTRIES } from "/shared/constants.js"
import { api } from "../api.js"
import { useApp } from "../context.js"
import { Badge, Banner, Button, Card, ConfirmModal, Field, Input, LinkButton, Loading, PageHeader, Select } from "../ui.js"

const REGISTER_URL = "https://rechnungsapi.de/register"
const DOCS_URL = "https://rechnungsapi.de/api-docs"
const SOURCE_URL = "https://github.com/Rechnungsapi/rechnungsapi-erp-demo"

export function SettingsPage() {
  const { t, lang, config, toast, errorText } = useApp()
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    api.get("/settings").then(setForm).catch(setLoadError)
  }, [])

  if (loadError) return html`<${Banner} tone="err" icon="alert">${errorText(loadError)}<//>`
  if (!form) return html`<${Loading} />`

  const company = (name) => ({ value: form.company[name] ?? "", onInput: (event) => setForm({ ...form, company: { ...form.company, [name]: event.target.value } }) })
  const defaults = (name) => {
    const change = (event) => setForm({ ...form, defaults: { ...form.defaults, [name]: event.target.value } })
    return { value: form.defaults[name], onInput: change, onChange: change }
  }
  const message = (_group, name) => (errors[name] ? t(`err.${errors[name]}`) : undefined)

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const saved = await api.put("/settings", {
        company: form.company,
        defaults: { ...form.defaults, paymentDays: Number(form.defaults.paymentDays), vatRate: Number(form.defaults.vatRate) },
      })
      setForm(saved)
      toast(t("common.saved"))
    } catch (error) {
      if (error.code === "validation") {
        setErrors(error.body.fields ?? {})
        toast(t("new.fixErrors"), "err")
      } else {
        toast(errorText(error), "err")
      }
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    setResetting(true)
    try {
      await api.post("/demo/reset")
      toast(t("set.reset.done"))
      setConfirmReset(false)
      setForm(await api.get("/settings"))
    } catch (error) {
      toast(errorText(error), "err")
    } finally {
      setResetting(false)
    }
  }

  return html`
    <${PageHeader} title=${t("set.title")} subtitle=${t("set.subtitle")} />

    <form class="stack" onSubmit=${save} noValidate>
      <${Card} title=${t("set.company")}>
        <div class="stack">
          <p class="small muted">${t("set.company.hint")}</p>
          <div class="grid grid-2">
            <${Field} class="span-all" label=${t("cus.name")} required error=${message("company", "name")}>${(control) => html`<${Input} ...${control} ...${company("name")} />`}<//>
            <${Field} class="span-all" label=${t("cus.street")} required error=${message("company", "street")}>${(control) => html`<${Input} ...${control} ...${company("street")} />`}<//>
            <${Field} label=${t("cus.zip")} required error=${message("company", "zip")}>${(control) => html`<${Input} ...${control} ...${company("zip")} />`}<//>
            <${Field} label=${t("cus.city")} required error=${message("company", "city")}>${(control) => html`<${Input} ...${control} ...${company("city")} />`}<//>
            <${Field} label=${t("cus.country")} required error=${message("company", "country")}>
              ${(control) => html`<${Select} ...${control} value=${form.company.country} onChange=${(event) => setForm({ ...form, company: { ...form.company, country: event.target.value } })}>
                ${COUNTRIES.map((country) => html`<option key=${country.code} value=${country.code}>${country[lang]} (${country.code})</option>`)}
              <//>`}
            <//>
            <${Field} label=${t("cus.vatId")} required error=${message("company", "vatId")}>${(control) => html`<${Input} ...${control} ...${company("vatId")} placeholder="DE123456789" />`}<//>
            <${Field} label=${t("set.contactName")} required error=${message("company", "contactName")}>${(control) => html`<${Input} ...${control} ...${company("contactName")} />`}<//>
            <${Field} label=${t("set.phone")} required error=${message("company", "phone")}>${(control) => html`<${Input} type="tel" ...${control} ...${company("phone")} />`}<//>
            <${Field} label=${t("cus.email")} required error=${message("company", "email")}>${(control) => html`<${Input} type="email" ...${control} ...${company("email")} />`}<//>
            <${Field} label=${t("set.website")} error=${message("company", "website")}>${(control) => html`<${Input} ...${control} ...${company("website")} />`}<//>
            <${Field} label=${t("set.iban")} required error=${message("company", "iban")}>${(control) => html`<${Input} class="mono" ...${control} ...${company("iban")} />`}<//>
            <${Field} label=${t("set.bic")} error=${message("company", "bic")}>${(control) => html`<${Input} class="mono" ...${control} ...${company("bic")} />`}<//>
          </div>
        </div>
      <//>

      <${Card} title=${t("set.defaults")}>
        <div class="grid grid-4">
          <${Field} label=${t("set.paymentDays")} error=${message("defaults", "paymentDays")}>
            ${(control) => html`<${Input} type="number" min="0" max="365" ...${control} ...${defaults("paymentDays")} />`}
          <//>
          <${Field} label=${t("set.vatRate")}>
            ${(control) => html`<${Select} ...${control} ...${defaults("vatRate")}>
              <option value="19">19 %</option>
              <option value="7">7 %</option>
              <option value="0">${t("new.vat.exempt")}</option>
            <//>`}
          <//>
          <${Field} label=${t("set.language")}>
            ${(control) => html`<${Select} ...${control} ...${defaults("language")}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            <//>`}
          <//>
          <${Field} label=${t("set.format")}>
            ${(control) => html`<${Select} ...${control} ...${defaults("format")}>
              <option value="zugferd">${t("format.zugferd")}</option>
              <option value="xrechnung">${t("format.xrechnung")}</option>
            <//>`}
          <//>
        </div>
      <//>

      <div class="row">
        <${Button} type="submit" variant="primary" loading=${saving}>${t("common.save")}<//>
      </div>
    </form>

    <${Card} title=${t("set.api")}>
      <div class="stack-sm">
        <div class="row">
          ${config.mock
            ? html`<${Badge} tone="info" icon="info">${t("set.api.mock")}<//>`
            : config.tokenConfigured
              ? html`<${Badge} tone="ok" icon="check">${t("set.api.token.set")}<//>`
              : html`<${Badge} tone="warn" icon="alert">${t("set.api.token.missing")}<//>`}
        </div>
        <p class="small muted">${t("set.api.howto")}</p>
        <div class="row">
          <${LinkButton} icon="external" href=${REGISTER_URL} target="_blank" rel="noopener">${t("set.api.register")}<//>
          <${LinkButton} icon="external" href=${DOCS_URL} target="_blank" rel="noopener">${t("set.api.docs")}<//>
        </div>
      </div>
    <//>

    <${Card} title=${t("set.danger")}>
      <div class="row-between">
        <p class="small muted" style=${{ maxWidth: "560px" }}>${t("set.danger.text")}</p>
        <${Button} variant="danger" icon="refresh" onClick=${() => setConfirmReset(true)}>${t("set.reset")}<//>
      </div>
    <//>

    <${Card} title=${t("set.about")}>
      <div class="row-between">
        <span class="small muted">${t("set.version", { version: config.version })}</span>
        <${LinkButton} size="sm" icon="external" href=${SOURCE_URL} target="_blank" rel="noopener">${t("set.source")}<//>
      </div>
    <//>

    ${confirmReset
      ? html`<${ConfirmModal}
          title=${t("set.reset")}
          text=${t("set.reset.confirm")}
          confirmLabel=${t("set.reset")}
          busy=${resetting}
          onConfirm=${reset}
          onCancel=${() => setConfirmReset(false)}
        />`
      : null}
  `
}
