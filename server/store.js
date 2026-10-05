import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { invoiceNumber } from "../shared/constants.js"
import { newId } from "./ids.js"
import { defaultDb } from "./seed.js"

// A stored file is "<random id>.pdf" or "<random id>.xml". Nothing else is ever opened,
// so an id that comes from a URL cannot point outside the data directory.
const FILE_ID = /^[A-Za-z0-9_-]{8,40}\.(pdf|xml)$/

const KEEP_ACTIVITY = 200

/**
 * A tiny database: one JSON file plus a folder of generated documents.
 * Writes are queued and atomic (temp file, then rename), so a crash never leaves half a file.
 */
export class Store {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir
    this.dbPath = path.join(dir, "db.json")
    this.filesDir = path.join(dir, "files")
    /** @type {import("../shared/types.js").Db} */
    this.data = defaultDb()
    /** @type {Promise<any>} */
    this.queue = Promise.resolve()
  }

  async init() {
    await mkdir(this.filesDir, { recursive: true })
    try {
      this.data = { ...defaultDb(), ...JSON.parse(await readFile(this.dbPath, "utf8")) }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      this.data = defaultDb()
      await this.#persist()
    }
    return this
  }

  /**
   * Runs `fn` on the data, then saves. Calls run one after another.
   *
   * @template T
   * @param {(data: import("../shared/types.js").Db) => T | Promise<T>} fn
   * @returns {Promise<T>}
   */
  mutate(fn) {
    const run = async () => {
      const result = await fn(this.data)
      await this.#persist()
      return result
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }

  async #persist() {
    const temp = `${this.dbPath}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(this.data, null, 2))
    await rename(temp, this.dbPath)
  }

  // --- Collections -----------------------------------------------------------------------------

  list(name) {
    return this.data[name]
  }

  find(name, id) {
    return this.data[name].find((item) => item.id === id)
  }

  insert(name, item) {
    return this.mutate((data) => {
      data[name].unshift(item)
      return item
    })
  }

  /** Merges `patch` into the item and returns it, or returns undefined when there is no such id. */
  update(name, id, patch) {
    return this.mutate((data) => {
      const item = data[name].find((entry) => entry.id === id)
      return item ? Object.assign(item, patch) : undefined
    })
  }

  /** Removes the item and returns it, or returns undefined when there is no such id. */
  remove(name, id) {
    return this.mutate((data) => {
      const index = data[name].findIndex((entry) => entry.id === id)
      return index === -1 ? undefined : data[name].splice(index, 1)[0]
    })
  }

  /** Keeps only the newest `max` items of a collection and returns the ones that were dropped. */
  trim(name, max) {
    return this.mutate((data) => data[name].splice(max))
  }

  saveSettings(settings) {
    return this.mutate((data) => {
      data.settings = settings
      return data.settings
    })
  }

  /** Newest first, capped, so the file stays small. */
  addActivity(entry) {
    return this.mutate((data) => {
      data.activity.unshift(entry)
      data.activity.length = Math.min(data.activity.length, KEEP_ACTIVITY)
    })
  }

  /** The next automatic number of the year, e.g. RE-2026-0007. It is only used up by `useInvoiceNumber`. */
  peekInvoiceNumber(year) {
    return invoiceNumber(year, (this.data.counters[year] ?? 0) + 1)
  }

  /**
   * Marks the automatic number as used. Call it only after the invoice was created: invoice numbers
   * must not have gaps, so a failed attempt must not consume one.
   */
  useInvoiceNumber(year) {
    return this.mutate((data) => {
      data.counters[year] = (data.counters[year] ?? 0) + 1
    })
  }

  // --- Generated documents -----------------------------------------------------------------------

  /**
   * @param {Buffer|string} content
   * @param {"pdf"|"xml"} extension
   * @returns {Promise<string>} the file id
   */
  async saveFile(content, extension) {
    const id = `${newId()}.${extension}`
    await writeFile(path.join(this.filesDir, id), content)
    return id
  }

  /** @returns {Promise<Buffer|null>} */
  async readFile(id) {
    if (!FILE_ID.test(id)) return null
    try {
      return await readFile(path.join(this.filesDir, id))
    } catch (error) {
      if (error?.code === "ENOENT") return null
      throw error
    }
  }

  async removeFile(id) {
    if (FILE_ID.test(id)) await rm(path.join(this.filesDir, id), { force: true })
  }

  /** Deletes everything and starts again with the sample data. */
  async reset() {
    await this.queue.catch(() => {})
    await rm(this.filesDir, { recursive: true, force: true })
    await mkdir(this.filesDir, { recursive: true })
    this.data = defaultDb()
    await this.#persist()
  }
}
