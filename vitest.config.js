import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
