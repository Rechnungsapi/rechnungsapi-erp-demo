import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DICT, translate, translatePlural } from "../public/js/i18n.js"
import { startDemo } from "./helpers.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = path.join(root, "public")

/** All files below a folder. */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const pageSources = walk(path.join(publicDir, "js"))
  .filter((file) => file.endsWith(".js") && !file.includes("vendor"))
  .map((file) => [path.relative(root, file), readFileSync(file, "utf8")])

/** @type {Awaited<ReturnType<typeof startDemo>>} */
let demo
beforeAll(async () => {
  demo = await startDemo()
})
afterAll(() => demo.close())

describe("the page the browser gets", () => {
  it("is plain HTML with one stylesheet and one module script, and nothing inline", async () => {
    const response = await fetch(`${demo.url}/`)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('<div id="root"></div>')
    expect(html).toContain('<script type="module" src="/js/main.js"></script>')
    expect(html).toContain('<link rel="stylesheet" href="/css/app.css" />')
    // The content security policy forbids all of these, so none may be needed.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/\sstyle\s*=/i)
    expect(html).not.toMatch(/<style[\s>]/i)
  })

  it("loads nothing from the internet", () => {
    const allowed = [
      "https://rechnungsapi.de", // links the user can click
      "https://github.com/Rechnungsapi/", // the source code
      "http://www.w3.org/2000/svg", // an XML namespace, not a request
    ]
    const files = walk(publicDir).filter((file) => /\.(html|js|css|svg)$/.test(file) && !file.endsWith("LICENSES.txt"))
    for (const file of files) {
      const text = readFileSync(file, "utf8")
      for (const url of text.match(/https?:\/\/[^\s"'`)<>]+/g) ?? []) {
        if (file.includes(`${path.sep}vendor${path.sep}`)) continue
        expect(
          allowed.some((prefix) => url.startsWith(prefix)),
          `${path.relative(root, file)} mentions ${url}`,
        ).toBe(true)
      }
    }
    // The vendored library must not fetch anything either. It only names XML namespaces.
    const vendored = readFileSync(path.join(publicDir, "js/vendor/htm-preact.js"), "utf8")
    for (const url of vendored.match(/https?:\/\/[^\s"'`)<>]+/g) ?? []) expect(url).toMatch(/^http:\/\/www\.w3\.org\//)
    expect(vendored).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts/)
  })

  it("serves every module the browser imports", async () => {
    const seen = new Set()
    const queue = ["/js/main.js"]
    while (queue.length) {
      const url = queue.pop()
      if (seen.has(url)) continue
      seen.add(url)
      const response = await fetch(`${demo.url}${url}`)
      expect(response.status, url).toBe(200)
      expect(response.headers.get("content-type"), url).toMatch(/javascript/)
      const source = await response.text()
      // Only the import lines at the top of a file count; the SDK code sample shown on the invoice
      // page is a string, not an import.
      const header = source.split("\n").slice(0, 30).join("\n")
      for (const match of header.matchAll(/^import\b[^\n]*?\bfrom\s+["']([^"']+)["']/gm)) {
        const target = match[1]
        expect(target, `${url} imports "${target}"`).toMatch(/^(\.{1,2}\/|\/)/)
        const resolved = target.startsWith("/") ? target : new URL(target, `http://x${url}`).pathname
        queue.push(resolved)
      }
    }
    expect(seen.size).toBeGreaterThan(15)
    expect([...seen]).toEqual(expect.arrayContaining(["/shared/money.js", "/shared/dates.js", "/js/vendor/htm-preact.js", "/js/pages/invoice-new.js"]))
  })

  it("serves the stylesheet and the icon", async () => {
    expect((await fetch(`${demo.url}/css/app.css`)).headers.get("content-type")).toContain("text/css")
    expect((await fetch(`${demo.url}/favicon.svg`)).headers.get("content-type")).toContain("image/svg+xml")
  })
})

describe("translations", () => {
  const en = Object.keys(DICT.en)
  const de = Object.keys(DICT.de)

  it("have the same keys in English and German", () => {
    expect(en.filter((key) => !(key in DICT.de))).toEqual([])
    expect(de.filter((key) => !(key in DICT.en))).toEqual([])
  })

  it("have no empty texts, and use the same placeholders in both languages", () => {
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const key of en) {
      expect(DICT.en[key].trim(), `en ${key}`).not.toBe("")
      expect(DICT.de[key].trim(), `de ${key}`).not.toBe("")
      expect(placeholders(DICT.de[key]), key).toEqual(placeholders(DICT.en[key]))
    }
  })

  it("cover every key the pages use", () => {
    const used = new Set()
    for (const [, source] of pageSources) {
      for (const match of source.matchAll(/\bt\(\s*["`]([a-zA-Z0-9_.]+)["`]/g)) used.add(match[1])
      for (const match of source.matchAll(/\btn\(\s*["`]([a-zA-Z0-9_.]+)["`]/g)) {
        used.add(`${match[1]}.one`)
        used.add(`${match[1]}.other`)
      }
    }
    expect(used.size).toBeGreaterThan(100)
    for (const key of used) expect(DICT.en, key).toHaveProperty([key])
  })

  it("cover the dynamic keys: formats, errors, units of file and actions", () => {
    for (const key of ["format.zugferd", "format.xrechnung", "format.zugferd.desc", "format.xrechnung.desc"]) expect(DICT.en).toHaveProperty([key])
    for (const code of ["required", "invalid", "too_long", "too_large", "too_many", "decimals", "date_order", "unknown"]) expect(DICT.en).toHaveProperty([`err.${code}`])
    for (const kind of ["pdf", "xml", "png", "jpeg", "tiff"]) expect(DICT.en).toHaveProperty([`in.type.${kind}`])
    for (const action of ["validate", "extract", "read", "convert"]) {
      expect(DICT.en).toHaveProperty([`in.action.${action}`])
      expect(DICT.en).toHaveProperty([`in.action.${action}.desc`])
    }
  })

  it("name every error code the server can send", () => {
    const codes = [
      "no_token", "unauthorized", "no_access", "missing_fields", "bad_input", "rate_limited", "conflict", "timeout", "unreachable", "upstream",
      "file_too_large", "payload_too_large", "unsupported_file", "number_taken", "seller_incomplete", "customer_incomplete", "not_found",
      "host_not_allowed", "cross_origin_blocked", "invalid_json", "validation", "internal_error",
    ]
    for (const code of codes) expect(DICT.en, code).toHaveProperty([`api.${code}`])
    // And the server sends no code the UI cannot name.
    const sent = new Set()
    for (const file of walk(path.join(root, "server")).filter((name) => name.endsWith(".js"))) {
      const source = readFileSync(file, "utf8")
      for (const match of source.matchAll(/new AppError\(\d+,\s*"([a-z_]+)"/g)) sent.add(match[1])
    }
    for (const code of sent) expect(DICT.en, `server sends "${code}"`).toHaveProperty([`api.${code}`])
  })

  it("fill in placeholders and fall back to the key", () => {
    expect(translate("en", "new.created", { number: "RE-1" })).toBe("Invoice RE-1 created.")
    expect(translate("de", "new.created", { number: "RE-1" })).toBe("Rechnung RE-1 wurde erstellt.")
    expect(translate("en", "no.such.key")).toBe("no.such.key")
    expect(translate("en", "new.created")).toBe("Invoice {number} created.")
  })

  it("choose singular and plural", () => {
    expect(translatePlural("en", "inv.status.invalid", 1)).toBe("1 issue")
    expect(translatePlural("en", "inv.status.invalid", 3)).toBe("3 issues")
    expect(translatePlural("de", "inv.status.invalid", 1)).toBe("1 Hinweis")
    expect(translatePlural("de", "inv.status.invalid", 2)).toBe("2 Hinweise")
  })
})

describe("the code of the pages", () => {
  it("never uses innerHTML or other ways to put text into the page unescaped", () => {
    for (const [file, source] of pageSources) {
      expect(source, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|\beval\(|new Function\(/)
    }
  })

  it("names every table column, also the one that only holds buttons", () => {
    for (const [file, source] of pageSources) {
      expect(source, file).not.toMatch(/<th\s*>\s*<\/th>|<th\s*\/>/)
    }
  })

  it("lets the keyboard reach and scroll a code block", () => {
    const ui = pageSources.find(([file]) => file.endsWith("ui.js"))[1]
    expect(ui).toContain('<pre tabindex="0"')
  })

  it("keeps the API token out of the browser code", () => {
    for (const [file, source] of pageSources) {
      expect(source, file).not.toMatch(/RECHNUNGSAPI_TOKEN\s*[:=]|Authorization|Bearer/)
    }
  })
})
