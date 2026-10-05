import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { DICT } from "../public/js/i18n.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => readFileSync(path.join(root, file), "utf8")
const pkg = JSON.parse(read("package.json"))
const readme = read("README.md")

// "X-Invoice" / "xinvoice" is another vendor's product name. The API's own route and field names
// are its contract and stay in the source, but nothing a reader is shown should use it.
const COMPETITOR_TERM = /x-?invoice/i
/** What a reader sees: the markdown with the link targets removed. */
const visibleText = (markdown) => markdown.replace(/\]\([^)]*\)/g, "]")

const docs = readdirSync(path.join(root, "docs"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => `docs/${name}`)
const textOfPublicFiles = ["README.md", "SECURITY.md", "LICENSE", "Dockerfile", "docker-compose.yml", ".env.example", "public/index.html", ...docs]

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (["node_modules", ".git", "data", "coverage"].includes(name)) return []
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const textFiles = walk(root).filter((file) => /\.(js|json|md|html|css|svg|yml|yaml|txt|example)$|Dockerfile|LICENSE|\.gitignore|\.dockerignore/.test(file) && !file.endsWith("package-lock.json"))

describe("the project presents itself as RechnungsAPI (rechnungsapi.de)", () => {
  it("says so in the package metadata", () => {
    expect(pkg.description).toContain("RechnungsAPI")
    expect(pkg.description).toContain("rechnungsapi.de")
    expect(pkg.homepage).toBe("https://rechnungsapi.de")
    expect(pkg.author).toMatchObject({ name: "RechnungsAPI", email: "support@rechnungsapi.de", url: "https://rechnungsapi.de" })
    expect(pkg.keywords).toEqual(expect.arrayContaining(["rechnungsapi", "rechnungsapi.de", "zugferd", "xrechnung", "e-invoicing"]))
    expect(pkg.license).toBe("MIT")
    expect(pkg.private).toBe(true) // a demo, never published to npm by accident
    expect(pkg.repository.url).toContain("github.com/Rechnungsapi/rechnungsapi-erp-demo")
  })

  it("opens the README with what this is and where it comes from, and links the next steps", () => {
    expect(readme.slice(0, 1400)).toContain("RechnungsAPI")
    expect(readme.slice(0, 1400)).toContain("rechnungsapi.de")
    for (const link of [
      "https://rechnungsapi.de/register",
      "https://rechnungsapi.de/api-docs",
      "https://github.com/Rechnungsapi/rechnungsapi-sdk",
      "https://github.com/Rechnungsapi/rechnungsapi-mcp",
      "https://rechnungsapi.de/contact",
      "support@rechnungsapi.de",
    ]) {
      expect(readme, link).toContain(link)
    }
  })

  it("shows a banner and screenshots that really exist in the repository", () => {
    const banner = readme.match(/raw\.githubusercontent\.com\/Rechnungsapi\/rechnungsapi-erp-demo\/main\/(assets\/[^"')\s]+)/)
    expect(banner, "the README should reference its banner").not.toBeNull()
    const svg = read(banner[1])
    expect(svg).toContain("<svg")
    expect(svg).toContain("rechnungsapi.de")

    const social = readFileSync(path.join(root, "assets/social-preview.png"))
    expect(social.subarray(1, 4).toString()).toBe("PNG")
    expect([social.readUInt32BE(16), social.readUInt32BE(20)]).toEqual([1280, 640]) // GitHub's recommended size

    const shots = [...readme.matchAll(/src="(docs\/screenshots\/[^"]+)"/g)].map((match) => match[1])
    expect(new Set(shots).size).toBeGreaterThanOrEqual(4)
    for (const shot of shots) {
      const image = readFileSync(path.join(root, shot))
      expect(image.subarray(1, 4).toString(), shot).toBe("PNG")
      expect(image.length, shot).toBeLessThan(400_000)
    }
  })

  it("only links to files that exist", () => {
    for (const file of ["README.md", "SECURITY.md", ...docs]) {
      const base = path.dirname(path.join(root, file))
      for (const match of read(file).matchAll(/\]\((?!https?:|mailto:|#)([^)#\s]+)(#[^)]*)?\)/g)) {
        expect(existsSync(path.resolve(base, match[1])), `${file} links to ${match[1]}`).toBe(true)
      }
      for (const match of read(file).matchAll(/(?:src|href)="(?!https?:|mailto:|#)([^"#]+)"/g)) {
        expect(existsSync(path.resolve(base, match[1])), `${file} points at ${match[1]}`).toBe(true)
      }
    }
  })
})

describe("names that should not appear", () => {
  it("keeps the other vendor's product name out of everything a reader sees", () => {
    for (const file of ["README.md", "SECURITY.md", ...docs]) expect(visibleText(read(file)), file).not.toMatch(COMPETITOR_TERM)
    expect([pkg.description, ...pkg.keywords].join("\n")).not.toMatch(COMPETITOR_TERM)
    expect(JSON.stringify(DICT)).not.toMatch(COMPETITOR_TERM)
    expect(read("public/index.html")).not.toMatch(COMPETITOR_TERM)
    expect(read("Dockerfile")).not.toMatch(COMPETITOR_TERM)
  })

  it("does not name a company or legal entity in the project's own words", () => {
    // The project is presented as RechnungsAPI only. (The sample data uses made-up company names.)
    const words = [pkg.description, JSON.stringify(pkg.author), JSON.stringify(DICT), ...textOfPublicFiles.map((file) => visibleText(read(file)))]
    for (const text of words) expect(text).not.toMatch(/\bGmbH\b/)
  })

  it("mentions no AI assistant anywhere in the repository", () => {
    const names = new RegExp(["cla", "ude|anthr", "opic"].join(""), "i")
    for (const file of textFiles) {
      if (file.endsWith("branding.test.js")) continue
      expect(readFileSync(file, "utf8"), path.relative(root, file)).not.toMatch(names)
    }
  })

  it("uses only reserved example domains for the sample e-mail addresses", () => {
    const allowed = /@(example\.(com|org|net)|rechnungsapi\.de)$/
    for (const file of ["server/seed.js", "scripts/seed-demo.js", "test/helpers.js", "test/mock-gateway.js", "README.md", ...docs]) {
      for (const address of read(file).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
        // Skip code like "user@host" patterns that are not addresses of a person or company.
        if (/^(git@github\.com)$/.test(address)) continue
        expect(address, `${file}: ${address}`).toMatch(allowed)
      }
    }
  })
})

describe("what the README says is true", () => {
  it("shows code that is really in the integration file", () => {
    const excerpt = readme.match(/```js\n\/\/ server\/einvoice\.js \(excerpt\)\n([\s\S]*?)```/)
    expect(excerpt, "the README should quote server/einvoice.js").not.toBeNull()
    const source = read("server/einvoice.js")
    const lines = excerpt[1].split("\n").map((line) => line.trimEnd()).filter((line) => line.trim() !== "" && line.trim() !== "// ...")
    expect(lines.length).toBeGreaterThan(10)
    for (const line of lines) expect(source, `not in einvoice.js: ${line}`).toContain(line)
  })

  it("calls the integration one file of about 200 lines, and it is", () => {
    const lines = read("server/einvoice.js").split("\n").length
    expect(lines).toBeGreaterThan(120)
    expect(lines).toBeLessThanOrEqual(260)
    // And it is the only file that imports the SDK.
    const importers = walk(path.join(root, "server")).filter((file) => /from "rechnungsapi-sdk"/.test(readFileSync(file, "utf8")))
    expect(importers.map((file) => path.relative(root, file))).toEqual(["server/einvoice.js"])
  })

  it("matches the badges and numbers it shows", () => {
    expect(Object.keys(pkg.dependencies)).toHaveLength(3) // "runtime dependencies: 3"
    expect(pkg.engines.node).toBe(">=22.12")
    expect(readme).toContain("22.12")
    expect(readme).toContain("npm run dev:mock")
    for (const script of ["start", "test", "typecheck", "dev:mock", "demo:seed"]) expect(pkg.scripts, script).toHaveProperty([script])
  })
})

describe("it ships safely", () => {
  it("runs the container as an unprivileged user, labelled as RechnungsAPI", () => {
    const dockerfile = read("Dockerfile")
    expect(dockerfile).toMatch(/^USER node$/m)
    expect(dockerfile).toContain('org.opencontainers.image.vendor="RechnungsAPI"')
    expect(dockerfile).toContain('org.opencontainers.image.source="https://github.com/Rechnungsapi/rechnungsapi-erp-demo"')
    expect(dockerfile).toContain("HEALTHCHECK")
  })

  it("publishes the container port on this machine only", () => {
    expect(read("docker-compose.yml")).toMatch(/"127\.0\.0\.1:3000:3000"/)
  })

  it("keeps secrets and data out of git, and ships no real token", () => {
    const ignore = read(".gitignore")
    for (const entry of [".env", "data/", "node_modules/"]) expect(ignore, entry).toContain(entry)
    expect(read(".env.example")).toMatch(/^RECHNUNGSAPI_TOKEN=$/m)
    expect(existsSync(path.join(root, ".env"))).toBe(false)
  })

  it("has a security policy that tells people how to report a problem", () => {
    expect(read("SECURITY.md")).toContain("support@rechnungsapi.de")
  })

  it("runs the tests in CI on the supported Node versions", () => {
    const workflow = read(".github/workflows/ci.yml")
    expect(workflow).toContain("npm test")
    expect(workflow).toContain("npm run typecheck")
    expect(workflow).toMatch(/node:\s*\[22,\s*24\]/)
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/)
  })
})
