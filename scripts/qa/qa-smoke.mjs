import { chromium } from "playwright";
import fs from "node:fs";

const URL = "http://127.0.0.1:4210";
const OUT = "/tmp/sa-qa";
const tabs = ["Cost & Tokens", "Wrapped", "Claude vs Codex", "Timeline", "Skills", "Settings"];
const issues = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push({ where: page.url(), text: msg.text() });
});
page.on("pageerror", (err) => consoleErrors.push({ where: page.url(), text: "PAGEERROR: " + err.message }));
page.on("requestfailed", (req) => {
  if (!/favicon/.test(req.url())) consoleErrors.push({ where: page.url(), text: `REQFAIL ${req.method()} ${req.url()} ${req.failure()?.errorText}` });
});

async function shot(name) { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log("shot:", name); }

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
await shot("00-landing");

for (const t of tabs) {
  console.log("=== tab:", t);
  const btn = page.getByRole("button", { name: new RegExp(`^${t.replace(/[()]/g, '\\$&')}`) });
  const count = await btn.count();
  if (count === 0) { console.log("  no button found for", t); continue; }
  await btn.first().click();
  await page.waitForTimeout(1200);
  await shot(`tab-${t.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`);
}

// Source filter via the FilterBar pill — verify banner appears
console.log("=== source filter banner ===");
await page.getByRole("button", { name: /^Cost & Tokens/ }).first().click();
await page.waitForTimeout(500);
// FilterBar source pills: "All", "Claude", "Codex"
const claudePill = page.getByRole("button", { name: /^Claude$/ });
const claudeCount = await claudePill.count();
console.log("Claude pill count:", claudeCount);
if (claudeCount > 0) {
  await claudePill.first().click();
  await page.waitForTimeout(600);
  const banner = await page.getByText("Source filter", { exact: false }).count();
  console.log("Source filter banner appears:", banner);
  await shot("source-claude-banner");
  // Esc to clear
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const after = await page.getByText("Source filter", { exact: false }).count();
  console.log("After Esc:", after);
}

// Skills tab — "You Made" card
console.log("=== Skills tab You Made card ===");
await page.getByRole("button", { name: /^Skills/ }).first().click();
await page.waitForTimeout(1000);
const youMadeCount = await page.getByText("You Made").count();
console.log("You Made label count:", youMadeCount);
await shot("skills-you-made");

// Wrapped tab — "Skills you made"
console.log("=== Wrapped tab Skills you made ===");
await page.getByRole("button", { name: /^Wrapped/ }).first().click();
await page.waitForTimeout(2000);
const syMade = await page.getByText("Skills you made").count();
console.log("Skills you made label count:", syMade);
await shot("wrapped-skills-you-made");

// Mobile viewport
await page.setViewportSize({ width: 375, height: 812 });
await page.getByRole("button", { name: /^Cost & Tokens/ }).first().click();
await page.waitForTimeout(800);
await shot("mobile-cost");

fs.writeFileSync(`${OUT}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("Total console errors:", consoleErrors.length);
await browser.close();
