import { html } from "./vendor/htm-preact.js"

// Simple 24x24 line icons, drawn for this demo. Each icon is a list of SVG path commands.
const PATHS = {
  dashboard: ["M4 4h6v7H4z", "M14 4h6v4h-6z", "M14 12h6v8h-6z", "M4 15h6v5H4z"],
  invoice: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6", "M9 17h6", "M9 9h2"],
  plus: ["M12 5v14", "M5 12h14"],
  upload: ["M12 16V4", "M8 8l4-4 4 4", "M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"],
  users: [
    "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20",
    "M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35",
    "M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  ],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  check: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M8 12.5l2.7 2.7L16 9.5"],
  cross: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.5 9.5l5 5", "M14.5 9.5l-5 5"],
  alert: ["M12 3.5L2.8 19.5h18.4z", "M12 10v4", "M12 17h.01"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v5", "M12 8h.01"],
  download: ["M12 4v11", "M8 11l4 4 4-4", "M4 19h16"],
  send: ["M21 3L10 14", "M21 3l-7 18-4-7-7-4z"],
  refresh: ["M20 11a8 8 0 0 0-14.5-3.5L4 9", "M4 4v5h5", "M4 13a8 8 0 0 0 14.5 3.5L20 15", "M20 20v-5h-5"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12", "M9 7V4h6v3"],
  edit: ["M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z", "M13.5 6.5l4 4"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"],
  external: ["M14 4h6v6", "M20 4L10 14", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  sun: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  copy: ["M9 9h10v11H9z", "M5 15V5a1 1 0 0 1 1-1h10"],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
  code: ["M8 8l-4 4 4 4", "M16 8l4 4-4 4", "M14 5l-4 14"],
  bolt: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  shield: ["M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z", "M9 12l2 2 4-4"],
  mail: ["M3 6h18v12H3z", "M3 7l9 6 9-6"],
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  chevron: ["M9 6l6 6-6 6"],
  layers: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  sparkles: ["M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"],
  euro: ["M17 6.5A6.5 6.5 0 0 0 6.5 9.5", "M17 17.5A6.5 6.5 0 0 1 6.5 14.5", "M4 10.5h9", "M4 13.5h9"],
  image: ["M4 5h16v14H4z", "M4 16l4.5-4.5L13 16l3-3 4 4"],
  convert: ["M4 8h14", "M14 4l4 4-4 4", "M20 16H6", "M10 12l-4 4 4 4"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
}

/** @param {{ name: keyof typeof PATHS, size?: number, class?: string }} props */
export function Icon({ name, size = 18, class: className = "" }) {
  const paths = PATHS[name] ?? []
  return html`<svg
    class=${`icon ${className}`.trim()}
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${paths.map((d) => html`<path d=${d} />`)}
  </svg>`
}

/** The logo mark in the sidebar: a document with a green check. */
export function BrandMark({ size = 22 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#fff" />
    <path d="M14 3v5h5" fill="#bfdbfe" />
    <path d="M8.5 12.5h6M8.5 15.5h4" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round" />
    <circle cx="16.5" cy="17.5" r="4.2" fill="#16a34a" stroke="#fff" stroke-width="1.4" />
    <path d="m14.6 17.6 1.3 1.3 2.3-2.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`
}
