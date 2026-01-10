import { defineConfig } from "@trigger.dev/sdk/v3"

export default defineConfig({
  project: "proj_tatxqfhifplupssiaget", // throxy-pipeline
  runtime: "node",
  logLevel: "log",
  maxDuration: 600, // 10 minutes for large CSV processing
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./trigger"],
})
