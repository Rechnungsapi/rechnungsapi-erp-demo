import path from "node:path"

/** Largest file the demo accepts for upload. The API itself limits a decoded file to 11 MiB. */
export const MAX_UPLOAD_MB = 10

/**
 * Reads the settings from environment variables.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(env = process.env) {
  const list = (value) =>
    String(value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)

  // PORT=0 asks the system for a free port, which the tests use.
  const port = env.PORT?.trim() ? Number(env.PORT) : 3000

  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: Number.isInteger(port) && port >= 0 && port < 65536 ? port : 3000,
    dataDir: path.resolve(env.DATA_DIR?.trim() || "data"),
    token: env.RECHNUNGSAPI_TOKEN?.trim() || "",
    baseUrl: env.RECHNUNGSAPI_BASE_URL?.trim() || undefined,
    v2BaseUrl: env.RECHNUNGSAPI_V2_BASE_URL?.trim() || undefined,
    allowedHosts: list(env.ALLOWED_HOSTS),
    /** True when the demo runs against the local mock gateway instead of the real API. */
    mock: env.DEMO_MOCK === "1",
  }
}

/** @typedef {ReturnType<typeof loadConfig>} Config */

/** Loads ".env" from the working directory when it exists (Node 20.12 and newer). */
export function loadDotEnv() {
  try {
    process.loadEnvFile()
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}
