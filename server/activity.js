import { newId } from "./ids.js"

/**
 * Keeps a short log of the API calls the demo made: which SDK method, whether it worked and how
 * long it took. It never records tokens, invoice data or file content.
 *
 * @param {import("./store.js").Store} store
 */
export function activityLogger(store) {
  /** @param {{ name: string, ok: boolean, ms: number, code?: string }} call */
  return ({ name, ok, ms, code }) => {
    store
      .addActivity({ id: newId("act_"), at: new Date().toISOString(), name, ok, ms, code })
      .catch((error) => console.error("[activity] could not save:", error.message))
  }
}
