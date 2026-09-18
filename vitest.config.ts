import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	esbuild: { jsx: "automatic" },
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["./vitest.setup.ts"],
		include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
		exclude: ["src/**/*.export-harness.test.ts"],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});
