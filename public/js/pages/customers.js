import { html, useEffect, useState } from "../vendor/htm-preact.js"
import { COUNTRIES } from "/shared/constants.js"
import { api } from "../api.js"
import { useApp } from "../context.js"
import { Icon } from "../icons.js"
import { Banner, Button, Card, ConfirmModal, EmptyState, Field, Input, Loading, Modal, PageHeader, Select } from "../ui.js"

const EMPTY = { name: "", street: "", zip: "", city: "", country: "DE", vatId: "", email: "", buyerReference: "" }

export function CustomersPage() {
  const { t, errorText, toast } = useApp()
  const [customers, setCustomers] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // a customer, or EMPTY for a new one
  const [removing, setRemoving] = useState(null)

  const load = () => api.get("/customers").then(setCustomers).catch(setError)
  useEffect(() => void load(), [])

  async function remove() {
    try {
      await api.del(`/customers/${removing.id}`)
      toast(t("common.deleted"))
      setRemoving(null)
      load()
    } catch (failure) {
      setRemoving(null)
      toast(errorText(failure), "err")
    }
  }

  return html`
    <${PageHeader} title=${t("cus.title")} subtitle=${t("cus.subtitle")}>
      <${Button} variant="primary" icon="plus" onClick=${() => setEditing(EMPTY)}>${t("cus.add")}<//>
    <//>

    ${error ? html`<${Banner} tone="err" icon="alert">${errorText(error)}<//>` : null}

    <${Card} flush>
      ${customers === null
        ? html`<${Loading} />`
        : customers.length === 0
          ? html`<${EmptyState} icon="users" title=${t("cus.empty")}><${Button} variant="primary" icon="plus" onClick=${() => setEditing(EMPTY)}>${t("cus.add")}<//><//>`
          : html`<div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>${t("cus.name")}</th>
                    <th>${t("cus.city")}</th>
                    <th>${t("cus.vatId")}</th>
                    <th>${t("cus.email")}</th>
                    <th>${t("cus.buyerReference")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${customers.map(
                    (customer) => html`<tr key=${customer.id}>
                      <td>
                        <div class="cell-title">${customer.name}</div>
                        <div class="small muted">${customer.street}</div>
                      </td>
                      <td class="nowrap">${customer.zip} ${customer.city}</td>
                      <td class="mono small">${customer.vatId || "–"}</td>
                      <td>${customer.email}</td>
                      <td class="mono small">${customer.buyerReference || "–"}</td>
                      <td class="right nowrap">
                        <${Button} size="sm" variant="ghost" icon="plus" onClick=${() => (location.hash = `#/invoices/new?customer=${customer.id}`)}>${t("nav.new")}<//>
                        <${Button} size="sm" variant="ghost" aria-label=${t("common.edit")} onClick=${() => setEditing(customer)}><${Icon} name="edit" size=${15} /><//>
                        <${Button} size="sm" variant="ghost" aria-label=${t("common.delete")} onClick=${() => setRemoving(customer)}><${Icon} name="trash" size=${15} /><//>
                      </td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>`}
    <//>

    ${editing
      ? html`<${CustomerForm}
          customer=${editing}
          onClose=${() => setEditing(null)}
          onSaved=${() => {
            setEditing(null)
            toast(t("common.saved"))
            load()
          }}
        />`
      : null}
    ${removing
      ? html`<${ConfirmModal}
          title=${t("common.delete")}
          text=${t("cus.delete.confirm", { name: removing.name })}
          confirmLabel=${t("common.delete")}
          onConfirm=${remove}
          onCancel=${() => setRemoving(null)}
        />`
      : null}
  `
}

function CustomerForm({ customer, onClose, onSaved }) {
  const { t, lang, errorText } = useApp()
  const [form, setForm] = useState({ ...EMPTY, ...customer })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState(null)
  const bind = (name) => ({ value: form[name] ?? "", onInput: (event) => setForm({ ...form, [name]: event.target.value }) })
  const message = (name) => (errors[name] ? t(`err.${errors[name]}`) : undefined)

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    setProblem(null)
    try {
      const { id, ...body } = form
      await (customer.id ? api.put(`/customers/${customer.id}`, body) : api.post("/customers", body))
      onSaved()
    } catch (error) {
      if (error.code === "validation") setErrors(error.body.fields ?? {})
      else setProblem(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  return html`<${Modal}
    title=${customer.id ? t("cus.edit") : t("cus.add")}
    onClose=${onClose}
    footer=${html`
      <${Button} onClick=${onClose}>${t("common.cancel")}<//>
      <${Button} type="submit" form="customer-form" variant="primary" loading=${saving}>${t("common.save")}<//>
    `}
  >
    <form id="customer-form" class="stack-sm" onSubmit=${save} noValidate>
      ${problem ? html`<${Banner} tone="err" icon="alert">${problem}<//>` : null}
      <${Field} label=${t("cus.name")} required error=${message("name")}>${(control) => html`<${Input} ...${control} ...${bind("name")} />`}<//>
      <${Field} label=${t("cus.street")} required error=${message("street")}>${(control) => html`<${Input} ...${control} ...${bind("street")} />`}<//>
      <div class="grid grid-3">
        <${Field} label=${t("cus.zip")} required error=${message("zip")}>${(control) => html`<${Input} ...${control} ...${bind("zip")} />`}<//>
        <${Field} class="span-2" label=${t("cus.city")} required error=${message("city")}>${(control) => html`<${Input} ...${control} ...${bind("city")} />`}<//>
      </div>
      <div class="grid grid-2">
        <${Field} label=${t("cus.country")} required error=${message("country")}>
          ${(control) => html`<${Select} ...${control} value=${form.country} onChange=${(event) => setForm({ ...form, country: event.target.value })}>
            ${COUNTRIES.map((country) => html`<option key=${country.code} value=${country.code}>${country[lang]} (${country.code})</option>`)}
          <//>`}
        <//>
        <${Field} label=${t("cus.vatId")} error=${message("vatId")}>${(control) => html`<${Input} ...${control} ...${bind("vatId")} placeholder="DE123456789" />`}<//>
      </div>
      <${Field} label=${t("cus.email")} required error=${message("email")}>${(control) => html`<${Input} type="email" ...${control} ...${bind("email")} />`}<//>
      <${Field} label=${t("cus.buyerReference")} hint=${t("cus.buyerReference.hint")} error=${message("buyerReference")}>
        ${(control) => html`<${Input} ...${control} ...${bind("buyerReference")} />`}
      <//>
    </form>
  <//>`
}
