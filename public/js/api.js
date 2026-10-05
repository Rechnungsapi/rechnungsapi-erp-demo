// The browser's side of the conversation with the demo server. The token never gets here.

export class ApiError extends Error {
  /** @param {number} status @param {Record<string, any>} [body] */
  constructor(status, body = {}) {
    super(body.message ?? `HTTP ${status}`)
    this.name = "ApiError"
    this.status = status
    /** A stable code such as "unauthorized"; "network" when the server did not answer. */
    this.code = body.error ?? "network"
    this.body = body
  }
}

async function request(method, path, body) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, { error: "network" })
  }
  const isJson = (response.headers.get("content-type") ?? "").includes("json")
  const payload = response.status === 204 ? null : isJson ? await response.json() : await response.blob()
  if (!response.ok) throw new ApiError(response.status, isJson ? payload : {})
  return payload
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body = {}) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  del: (path) => request("DELETE", path),
  /** The text of a stored file, for example the XML of an invoice. */
  async text(path) {
    const response = await fetch(`/api${path}`)
    if (!response.ok) throw new ApiError(response.status)
    return response.text()
  },
}

/** Reads a File as base64 text (without the "data:" prefix). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Starts a download of a Blob. */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
