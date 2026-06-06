import { test, expect } from "@playwright/test";

// The app runs against its mock library when not inside Tauri, so these E2E flows
// are deterministic without a real Steam install.

test("renders the library", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Elden Ring")).toBeVisible();
  await expect(page.locator(".footer")).toContainText("games");
});

test("filters the library with search", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder(/Filter by name/).fill("factorio");
  await expect(page.getByText("Factorio")).toBeVisible();
  await expect(page.getByText("Elden Ring")).toHaveCount(0);
});

test("opens the structured builder and validates the line", async ({ page }) => {
  await page.goto("/");
  // open the builder from the first game that has a launch line
  await page.locator(".launch-cell").first().click();
  await expect(page.locator(".builder")).toBeVisible();
  // add a wrapper from the catalogue; the line becomes valid with one %command%
  await page.locator(".builder-cat .cat-item", { hasText: "Native (Wayland)" }).click();
  await expect(page.locator(".pill.is-wrapper")).toContainText("%command%");
  await expect(page.locator(".vstat.ok")).toBeVisible();
});

test("composes from the catalogue", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Elden Ring").click();
  await page.getByRole("button", { name: /Set launch options/ }).click();
  await expect(page.locator(".builder")).toBeVisible();
  await page.locator(".builder-cat .cat-item", { hasText: "DXVK_HUD" }).first().click();
  await expect(page.locator(".pill", { hasText: "DXVK_HUD" })).toBeVisible();
});

test("navigates to the Presets and Backups tabs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Presets/ }).click();
  await expect(page.getByRole("heading", { name: "Presets" })).toBeVisible();
  await page.getByRole("button", { name: /Backups/ }).click();
  await expect(page.getByText(/Every write snapshots/)).toBeVisible();
});

test("opens the command palette", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Search/ }).click();
  await expect(page.getByPlaceholder(/Type a command/)).toBeVisible();
});
