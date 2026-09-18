import { expect, test } from "@playwright/test";
test("identity reset initializes a new thread without replaying the rejected action", async ({ page }) => {
	await page.goto("/");
	await page.locator("#agent-launcher").click();
	const input = page.getByRole("textbox");
	await expect(input).toBeEnabled();
	const thread = await page.evaluate(() => localStorage.getItem("paper.agent.thread.v1"));
	let requests = 0;
	await page.route("**/api/agent", async (route) => {
		requests++;
		await route.fulfill({
			status: 409,
			contentType: "application/json",
			body: JSON.stringify({ error: "agent_identity_reset" }),
		});
	});
	await input.fill("open cart");
	await input.press("Enter");
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("paper.agent.thread.v1")))
		.not.toBe(thread);
	await expect(input).toBeEnabled();
	await expect(page.getByLabel("Cart state")).toHaveText("closed");
	expect(requests).toBe(1);
});
// Isolated browser contract tests; does not substitute for deployed Saleor/Adapter E2E.
test("streams chat, executes a tool and retains visitor identity across new conversations", async ({
	page,
}) => {
	await page.goto("/");
	await page.locator("#agent-launcher").click();
	const input = page.getByRole("textbox");
	await input.fill("hello");
	await input.press("Enter");
	await expect(page.getByText("Hello", { exact: true })).toBeVisible();
	await expect(page.getByText("Hello from the assistant")).toBeVisible();
	const before = await page.evaluate(() => ({
		visitor: localStorage.getItem("paper.agent.visitor.v1"),
		thread: localStorage.getItem("paper.agent.thread.v1"),
	}));
	await input.fill("open cart");
	await input.press("Enter");
	await expect(page.getByLabel("Cart state")).toHaveText("open");
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "New conversation" }).click();
	const after = await page.evaluate(() => ({
		visitor: localStorage.getItem("paper.agent.visitor.v1"),
		thread: localStorage.getItem("paper.agent.thread.v1"),
	}));
	expect(after.visitor).toBe(before.visitor);
	expect(after.thread).not.toBe(before.thread);
	await expect(page.getByText("Hello from the assistant")).toHaveCount(0);
});
test("mobile panel stays in view and returns keyboard focus after closing", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.locator("#agent-launcher").click();
	const panel = page.getByRole("dialog");
	await expect(panel).toBeVisible();
	const bounds = await panel.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
	await page.screenshot({ path: "test-results/agent-mobile.png" });
	await page.keyboard.press("Escape");
	await expect(panel).toBeHidden();
	await expect(page.locator("#agent-launcher")).toBeFocused();
});
