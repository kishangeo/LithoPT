// Cross-browser end-to-end tests (Chromium, Firefox, WebKit = Safari engine).
const { defineConfig, devices } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "test/e2e",
  timeout: 60000,
  reporter: [["list"]],
  webServer: { command: "python -m http.server 8766", url: "http://localhost:8766", reuseExistingServer: true, timeout: 30000 },
  use: { baseURL: "http://localhost:8766" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } } // local runs without downloaded browsers
  ]
});
