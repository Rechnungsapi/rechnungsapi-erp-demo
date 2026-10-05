import { MAX_UPLOAD_MB } from "../config.js"
import { AppError } from "../http-errors.js"

// Files arrive from the browser as base64 inside JSON. This decodes them and works out what they
// are from their first bytes, never from the file name or the content type the browser claims.

/** @typedef {"pdf"|"xml"|"png"|"jpeg"|"tiff"} FileKind */

/** @param {Buffer} buffer @returns {FileKind|null} */
export function detectKind(buffer) {
  const head = buffer.subarray(0, 8)
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf"
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "png"
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg"
  const tiff = head.subarray(0, 4).toString("latin1")
  if (tiff === "II*\0" || tiff === "MM\0*") return "tiff"
  // XML may start with a byte order mark and white space before the first "<".
  const start = buffer.subarray(0, 64).toString("utf8").replace(/^﻿/, "").trimStart()
  if (start.startsWith("<")) return "xml"
  return null
}

/**
 * Decodes an upload and checks its size and type.
 *
 * @param {unknown} input             The request body: { fileName, fileBase64 }.
 * @param {FileKind[]} allowed        The kinds this action accepts.
 * @returns {{ buffer: Buffer, fileName: string, kind: FileKind }}
 */
export function readUpload(input, allowed) {
  const body = /** @type {Record<string, unknown>} */ (input && typeof input === "object" ? input : {})
  if (typeof body.fileBase64 !== "string" || !body.fileBase64) {
    throw new AppError(422, "validation", "Please choose a file.", { fields: { file: "required" } })
  }
  const base64 = body.fileBase64.replace(/^data:[^;,]*;base64,/, "").replace(/\s+/g, "")
  if (base64.length > Math.ceil((MAX_UPLOAD_MB * 1024 * 1024 * 4) / 3) + 8) {
    throw new AppError(413, "file_too_large", `The file is larger than ${MAX_UPLOAD_MB} MB.`, { limitMb: MAX_UPLOAD_MB })
  }
  const buffer = Buffer.from(base64, "base64")
  if (buffer.length === 0) throw new AppError(422, "validation", "The file is empty.", { fields: { file: "required" } })
  if (buffer.length > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new AppError(413, "file_too_large", `The file is larger than ${MAX_UPLOAD_MB} MB.`, { limitMb: MAX_UPLOAD_MB })
  }

  const kind = detectKind(buffer)
  if (!kind || !allowed.includes(kind)) {
    throw new AppError(415, "unsupported_file", "This kind of file is not supported here.", { detected: kind, allowed })
  }
  const fileName = (typeof body.fileName === "string" ? body.fileName : "invoice")
    .replace(/[\u0000-\u001f"\\/]+/g, " ")
    .trim()
    .slice(0, 120)
  return { buffer, fileName: fileName || "invoice", kind }
}
