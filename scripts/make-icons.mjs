// Renders assets/icon.svg (source, not shipped) to the PNG sizes Chrome uses in extension/icons/. Run after editing the SVG:
//   node scripts/make-icons.mjs        (needs Playwright with Chromium, like the UI tests)
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "extension/icons");
const svg = await readFile(join(root, "assets/icon.svg"), "utf8");
const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Only the 128 px store icon keeps the 16 px padding; smaller sizes crop to the artwork so it stays legible.
  let art = size < 128 ? svg.replace('viewBox="0 0 128 128"', 'viewBox="16 16 96 96"') : svg;
  // At 16 px the pulse line blurs into noise; the magnifier alone reads better.
  if (size === 16) art = art.replace(/<path id="pulse"[^>]*\/>/, "");
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${art}`);
  await page.screenshot({ path: join(dir, `icon-${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
console.log("Wrote icon-16/32/48/128.png");
