// IBAN checks that work in the browser and on the server.

/** Removes spaces and upper-cases: "de89 3704 0044 0532 0130 00" becomes "DE89370400440532013000". */
export const normalizeIban = (value) => String(value ?? "").replace(/\s+/g, "").toUpperCase()

/** True when the IBAN has the right shape and passes the ISO 7064 mod-97 check. */
export function isValidIban(value) {
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    // Letters count as two digits (A = 10 ... Z = 35).
    const digits = char >= "A" ? String(char.charCodeAt(0) - 55) : char
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}
