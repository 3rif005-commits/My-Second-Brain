import { chromium } from "/home/user/My-Second-Brain/frontend/node_modules/playwright/index.mjs";
const S = process.env.AUDIT_TMP ?? "/tmp/ui-audit";
const out = "/home/user/My-Second-Brain/docs/ui-audit/app-screens";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const theme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 649 }, storageState: `${S}/auth.json` });
  await ctx.addInitScript((t) => localStorage.setItem("sb-theme", t), theme);
  const p = await ctx.newPage();
  await p.goto("http://localhost:3000/brain"); await p.waitForTimeout(3000);
  await p.getByText("Untitled").last().click(); await p.waitForTimeout(5000);
  console.log(p.url());
  await p.screenshot({ path: `${out}/note-${theme}.png` });
  await p.keyboard.press("Control+k"); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/search-${theme}.png` });
  await p.keyboard.press("Escape");
  const ed = p.locator(".bn-editor").first();
  if (await ed.count()) { await ed.click(); await p.keyboard.press("End"); await p.keyboard.press("Enter"); await p.keyboard.type("/"); await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/note-slash-${theme}.png` }); await p.keyboard.press("Escape"); await p.keyboard.press("Backspace"); }
  await ctx.close();
}
await b.close();
