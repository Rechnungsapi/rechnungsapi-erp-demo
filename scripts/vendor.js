// Copies the one third-party library of the UI into public/js/vendor.
//
// The browser code uses htm + Preact (a tiny React-like library) as a single file. It is committed
// to the repository, so the demo needs no build step and no CDN: nothing is loaded from the
// internet when you open it. Run `npm run vendor` only to update the library.

import { copyFile, readFile, writeFile } from "node:fs/promises"

const root = new URL("../", import.meta.url)
const htm = JSON.parse(await readFile(new URL("node_modules/htm/package.json", root), "utf8"))

await copyFile(new URL("node_modules/htm/preact/standalone.module.js", root), new URL("public/js/vendor/htm-preact.js", root))

const apache = await readFile(new URL("node_modules/htm/LICENSE", root), "utf8")
await writeFile(
  new URL("public/js/vendor/LICENSES.txt", root),
  `htm-preact.js is the "standalone" build of htm ${htm.version} (https://github.com/developit/htm),
which bundles Preact (https://preactjs.com). Both licenses follow.

======================================================================
htm: Apache License 2.0
======================================================================

${apache}
======================================================================
Preact: MIT License
======================================================================

The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
)

console.log(`Copied htm ${htm.version} (standalone, with Preact) to public/js/vendor/`)
