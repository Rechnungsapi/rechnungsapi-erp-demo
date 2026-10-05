import { html } from "./vendor/htm-preact.js"

// Light syntax highlighting for the JSON and XML the demo shows. No library: a few regular expressions.

const MAX_CHARS = 200_000

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

export function highlightJson(text) {
  const out = []
  let last = 0
  for (const match of text.matchAll(JSON_TOKEN)) {
    if (match.index > last) out.push(text.slice(last, match.index))
    if (match[1]) {
      out.push(html`<span class=${match[2] ? "tok-key" : "tok-str"}>${match[1]}</span>`)
      if (match[2]) out.push(match[2])
    } else if (match[3]) {
      out.push(html`<span class="tok-lit">${match[3]}</span>`)
    } else {
      out.push(html`<span class="tok-num">${match[0]}</span>`)
    }
    last = match.index + match[0].length
  }
  out.push(text.slice(last))
  return out
}

const XML_TOKEN = /(<!--[\s\S]*?-->)|(<\?[\s\S]*?\?>)|(<\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?>)/g
const XML_ATTRIBUTE = /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g

export function highlightXml(text) {
  const out = []
  let last = 0
  for (const match of text.matchAll(XML_TOKEN)) {
    if (match.index > last) out.push(text.slice(last, match.index))
    if (match[1]) {
      out.push(html`<span class="tok-comment">${match[1]}</span>`)
    } else if (match[2]) {
      out.push(html`<span class="tok-comment">${match[2]}</span>`)
    } else {
      out.push(match[3], html`<span class="tok-tag">${match[4]}</span>`)
      let from = 0
      const attributes = match[5] ?? ""
      for (const attribute of attributes.matchAll(XML_ATTRIBUTE)) {
        out.push(attributes.slice(from, attribute.index))
        out.push(html`<span class="tok-attr">${attribute[1]}</span>`, attribute[2], html`<span class="tok-str">${attribute[3]}</span>`)
        from = attribute.index + attribute[0].length
      }
      out.push(attributes.slice(from), match[6])
    }
    last = match.index + match[0].length
  }
  out.push(text.slice(last))
  return out
}

const JS_TOKEN = /(\/\/[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(import|from|const|let|await|async|new|return|export|function)\b/g

export function highlightJs(text) {
  const out = []
  let last = 0
  for (const match of text.matchAll(JS_TOKEN)) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const kind = match[1] ? "tok-comment" : match[2] ? "tok-str" : "tok-lit"
    out.push(html`<span class=${kind}>${match[0]}</span>`)
    last = match.index + match[0].length
  }
  out.push(text.slice(last))
  return out
}

/** Puts every element of a one-line XML on its own line and indents it. */
export function formatXml(xml) {
  const tokens = String(xml).replace(/>\s+</g, "><").split(/(<[^>]+>)/).filter((token) => token !== "")
  const lines = []
  let depth = 0
  const indent = () => "  ".repeat(depth)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.startsWith("</")) {
      depth = Math.max(0, depth - 1)
      lines.push(indent() + token)
    } else if (token.startsWith("<?") || token.startsWith("<!") || token.endsWith("/>")) {
      lines.push(indent() + token)
    } else if (token.startsWith("<")) {
      const text = tokens[index + 1]
      const close = tokens[index + 2]
      if (text !== undefined && !text.startsWith("<") && close?.startsWith("</")) {
        lines.push(indent() + token + text + close)
        index += 2
      } else {
        lines.push(indent() + token)
        depth += 1
      }
    } else {
      lines.push(indent() + token.trim())
    }
  }
  return lines.join("\n")
}

/** Shortens a very long text for display. @returns {{ text: string, truncated: boolean }} */
export function clip(text) {
  return text.length > MAX_CHARS ? { text: text.slice(0, MAX_CHARS), truncated: true } : { text, truncated: false }
}
