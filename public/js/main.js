import { html, render, useCallback, useEffect, useMemo, useState } from "./vendor/htm-preact.js"
import { api } from "./api.js"
import { AppContext } from "./context.js"
import { formatters } from "./format.js"
import { initialLanguage, translate, translatePlural } from "./i18n.js"
import { BrandMark, Icon } from "./icons.js"
import { CustomersPage } from "./pages/customers.js"
import { DashboardPage } from "./pages/dashboard.js"
import { IncomingPage } from "./pages/incoming.js"
import { InvoiceDetailPage } from "./pages/invoice-detail.js"
import { InvoiceNewPage } from "./pages/invoice-new.js"
import { InvoicesPage } from "./pages/invoices.js"
import { SettingsPage } from "./pages/settings.js"
import { Banner, LinkButton, Loading, Toasts } from "./ui.js"

const REGISTER_URL = "https://rechnungsapi.de/register"
const DOCS_URL = "https://rechnungsapi.de/api-docs"

// --- Routing ---------------------------------------------------------------------------------------------

/** "#/invoices/inv_abc?x=1" becomes { name: "invoice", params: { id: "inv_abc" }, query }. */
function parseRoute(hash) {
  const [path, queryString = ""] = hash.replace(/^#/, "").split("?")
  const parts = path.split("/").filter(Boolean)
  const query = Object.fromEntries(new URLSearchParams(queryString))
  if (parts[0] === "invoices" && parts[1] === "new") return { name: "new", params: {}, query }
  if (parts[0] === "invoices" && parts[1]) return { name: "invoice", params: { id: parts[1] }, query }
  if (parts[0] === "invoices") return { name: "invoices", params: {}, query }
  if (["incoming", "customers", "settings"].includes(parts[0])) return { name: parts[0], params: {}, query }
  return { name: "dashboard", params: {}, query }
}

function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(location.hash))
      window.scrollTo(0, 0)
    }
    addEventListener("hashchange", onChange)
    return () => removeEventListener("hashchange", onChange)
  }, [])
  return route
}

const navigate = (path) => {
  location.hash = `#${path}`
}

// --- Theme -----------------------------------------------------------------------------------------------

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") ?? "auto"
    } catch {
      return "auto"
    }
  })
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme")
    else document.documentElement.setAttribute("data-theme", theme)
    try {
      theme === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", theme)
    } catch {
      // Storage can be blocked; the theme then lasts until the page is closed.
    }
  }, [theme])

  const toggle = () => {
    const dark = theme === "auto" ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark"
    setTheme(dark ? "light" : "dark")
  }
  const isDark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches)
  return { toggle, isDark }
}

// --- The app ---------------------------------------------------------------------------------------------

function App() {
  const route = useRoute()
  const [lang, setLangState] = useState(initialLanguage)
  const [config, setConfig] = useState(null)
  const [toasts, setToasts] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const theme = useTheme()

  const setLang = useCallback((next) => {
    setLangState(next)
    try {
      localStorage.setItem("lang", next)
    } catch {
      // Not saved, but the page still switches.
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = `${translate(lang, "app.name")} · ${translate(lang, "app.poweredBy")}`
  }, [lang])

  const refreshConfig = useCallback(() => api.get("/config").then(setConfig).catch(() => setConfig({ tokenConfigured: false, mock: false, maxUploadMb: 10, version: "" })), [])
  useEffect(() => void refreshConfig(), [refreshConfig])
  useEffect(() => setMenuOpen(false), [route])

  const context = useMemo(() => {
    const t = (key, params) => translate(lang, key, params)
    return {
      lang,
      setLang,
      config,
      refreshConfig,
      navigate,
      t,
      tn: (key, count, params) => translatePlural(lang, key, count, params),
      fmt: formatters(lang),
      toast(message, tone = "ok") {
        const id = Math.random().toString(36).slice(2)
        setToasts((list) => [...list, { id, message, tone }])
        setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), tone === "err" ? 7000 : 3500)
      },
      /** A readable message for any failure of an API call. */
      errorText(error) {
        const key = `api.${error?.code ?? "internal_error"}`
        const text = translate(lang, key, error?.body ?? {})
        return text === key ? error?.message || t("common.error") : text
      },
    }
  }, [lang, config, setLang, refreshConfig])

  const pages = {
    dashboard: DashboardPage,
    invoices: InvoicesPage,
    new: InvoiceNewPage,
    invoice: InvoiceDetailPage,
    incoming: IncomingPage,
    customers: CustomersPage,
    settings: SettingsPage,
  }
  const Page = pages[route.name]
  const { t } = context

  const links = [
    { group: "nav.group.sales", items: [["dashboard", "/", "dashboard", "nav.dashboard"], ["invoices", "/invoices", "invoice", "nav.invoices"], ["new", "/invoices/new", "plus", "nav.new"]] },
    { group: "nav.group.documents", items: [["incoming", "/incoming", "upload", "nav.incoming"]] },
    { group: "nav.group.setup", items: [["customers", "/customers", "users", "nav.customers"], ["settings", "/settings", "settings", "nav.settings"]] },
  ]
  const active = (name) => route.name === name || (name === "invoices" && route.name === "invoice")

  const status = !config ? null : config.mock ? ["dot-mock", "status.mock"] : config.tokenConfigured ? ["dot-ok", "status.ready"] : ["dot-warn", "status.noToken"]

  return html`<${AppContext.Provider} value=${context}>
    <div class="topbar">
      <button type="button" class="icon-btn" aria-label=${t("nav.menu")} onClick=${() => setMenuOpen(true)}><${Icon} name="menu" /></button>
      <strong>${t("app.name")}</strong>
    </div>
    <div class=${`backdrop ${menuOpen ? "open" : ""}`} onClick=${() => setMenuOpen(false)}></div>

    <div class="app">
      <aside class=${`sidebar ${menuOpen ? "open" : ""}`}>
        <div class="brand">
          <div class="brand-mark"><${BrandMark} /></div>
          <div>
            <div class="brand-name">${t("app.name")}</div>
            <div class="brand-sub">${t("app.poweredBy")}</div>
          </div>
        </div>

        <nav class="nav" aria-label=${t("nav.menu")}>
          ${links.map(
            (group) => html`<div class="nav-label">${t(group.group)}</div>
              ${group.items.map(
                ([name, path, icon, label]) => html`<a
                  key=${name}
                  class=${`nav-item ${active(name) ? "active" : ""}`}
                  href=${`#${path}`}
                  aria-current=${active(name) ? "page" : undefined}
                ><${Icon} name=${icon} />${t(label)}</a>`,
              )}`,
          )}
        </nav>

        <div class="sidebar-footer">
          ${status ? html`<span class="pill"><span class=${`dot ${status[0]}`}></span>${t(status[1])}</span>` : null}
          <a class="nav-item" href=${DOCS_URL} target="_blank" rel="noopener"><${Icon} name="external" />${t("nav.docs")}</a>
          <div class="sidebar-row">
            <div class="lang" role="group" aria-label=${t("nav.language")}>
              <button type="button" aria-pressed=${lang === "en"} onClick=${() => setLang("en")}>EN</button>
              <button type="button" aria-pressed=${lang === "de"} onClick=${() => setLang("de")}>DE</button>
            </div>
            <button type="button" class="icon-btn" aria-label=${t("nav.theme")} title=${t("nav.theme")} onClick=${theme.toggle}>
              <${Icon} name=${theme.isDark ? "sun" : "moon"} size=${16} />
            </button>
          </div>
        </div>
      </aside>

      <main class="main">
        <div class="page stack">
          ${config?.mock
            ? html`<${Banner} tone="mock" icon="info"><strong>${t("banner.mock.title")}</strong> ${t("banner.mock.text")}<//>`
            : null}
          ${config && !config.tokenConfigured && !config.mock && !["dashboard", "settings"].includes(route.name)
            ? html`<${Banner} tone="warn" icon="alert">
                <strong>${t("banner.noToken.title")}</strong> ${t("banner.noToken.text")}
                <a href=${REGISTER_URL} target="_blank" rel="noopener">${t("banner.noToken.cta")}</a>
              <//>`
            : null}
          ${config ? html`<${Page} key=${`${route.name}-${route.params.id ?? ""}`} route=${route} />` : html`<${Loading} />`}
        </div>
      </main>
    </div>
    <${Toasts} toasts=${toasts} />
  <//>`
}

render(html`<${App} />`, document.getElementById("root"))
