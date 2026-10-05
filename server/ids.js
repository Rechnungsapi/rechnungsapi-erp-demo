import { randomBytes } from "node:crypto"

/** A short random id such as "inv_x8Kq2LmP0aWd". Safe to use in URLs and file names. */
export const newId = (prefix = "") => `${prefix}${randomBytes(9).toString("base64url")}`
