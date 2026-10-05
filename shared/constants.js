// Option lists shared by the form (browser) and the validation (server).

/** Units of measure (UN/ECE Recommendation 20 codes, as EN 16931 expects them). */
export const UNITS = [
  { code: "C62", de: "Stück", en: "Piece" },
  { code: "HUR", de: "Stunde", en: "Hour" },
  { code: "DAY", de: "Tag", en: "Day" },
  { code: "MON", de: "Monat", en: "Month" },
  { code: "KGM", de: "kg", en: "kg" },
  { code: "MTR", de: "m", en: "m" },
  { code: "LTR", de: "l", en: "l" },
  { code: "LS", de: "Pauschale", en: "Lump sum" },
]

export const COUNTRIES = [
  { code: "DE", de: "Deutschland", en: "Germany" },
  { code: "AT", de: "Österreich", en: "Austria" },
  { code: "CH", de: "Schweiz", en: "Switzerland" },
  { code: "NL", de: "Niederlande", en: "Netherlands" },
  { code: "BE", de: "Belgien", en: "Belgium" },
  { code: "LU", de: "Luxemburg", en: "Luxembourg" },
  { code: "FR", de: "Frankreich", en: "France" },
  { code: "IT", de: "Italien", en: "Italy" },
  { code: "ES", de: "Spanien", en: "Spain" },
  { code: "PL", de: "Polen", en: "Poland" },
  { code: "CZ", de: "Tschechien", en: "Czechia" },
  { code: "DK", de: "Dänemark", en: "Denmark" },
]

export const FORMATS = ["zugferd", "xrechnung"]
export const LANGUAGES = ["de", "en"]

/** Invoice numbers look like RE-2026-0001. */
export const invoiceNumber = (year, counter) => `RE-${year}-${String(counter).padStart(4, "0")}`
