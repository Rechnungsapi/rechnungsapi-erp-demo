import { createContext, useContext } from "./vendor/htm-preact.js"

/**
 * What every page may use:
 *   t(key, params), tn(key, count, params)  texts in the current language
 *   fmt                                      money and date formatting
 *   lang, setLang
 *   config                                   what the server says about itself
 *   toast(message, tone)
 *   navigate("/invoices")
 *   errorText(error)                         a readable message for any failure
 */
export const AppContext = createContext(/** @type {any} */ (null))

export const useApp = () => useContext(AppContext)
