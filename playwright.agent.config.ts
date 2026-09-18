import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
	testDir: "./e2e",
	testMatch: "agent.spec.ts",
	reporter: "list",
	use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3021", trace: "retain-on-failure" },
	webServer: {
		command: "node e2e/agent-harness/server.mjs",
		url: "http://127.0.0.1:3021",
		timeout: 60_000,
		reuseExistingServer: false,
	},
});
