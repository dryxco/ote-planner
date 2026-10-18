// Renders the app icon (plan outline vs. actual fill on the 10-minute grid) to PNGs in public/icons.
import { chromium } from "playwright";

const html = (size, pad) => `<!doctype html><html><body style="margin:0;background:#000">
<div style="width:${size}px;height:${size}px;background:#0b0b0c;position:relative;overflow:hidden">
  <svg width="${size}" height="${size}" viewBox="0 0 120 120" style="position:absolute;inset:0">
    <g transform="translate(${pad} ${pad}) scale(${(120 - 2 * pad) / 120})">
      <!-- 10-minute grid: 3 hour rows x 6 cells per column -->
      ${[0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5].map((c) => `<rect x="${8 + c * 8}" y="${28 + r * 22}" width="7" height="20" rx="1.5" fill="#1c1c1e"/>`).join("")).join("")}
      ${[0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5].map((c) => `<rect x="${64 + c * 8}" y="${28 + r * 22}" width="7" height="20" rx="1.5" fill="#141416"/>`).join("")).join("")}
      <!-- plan: outlined, wraps from row 1 (right half) into row 2 -->
      <rect x="32.75" y="28.75" width="22.5" height="18.5" rx="3" fill="#0b0b0c" stroke="#e8e8ec" stroke-width="1.6"/>
      <rect x="8.75" y="50.75" width="30.5" height="18.5" rx="3" fill="#0b0b0c" stroke="#e8e8ec" stroke-width="1.6"/>
      <!-- actual: filled, slightly later -->
      <rect x="96" y="28" width="15" height="20" rx="3" fill="#2f7fd8"/>
      <rect x="64" y="50" width="39" height="20" rx="3" fill="#2f7fd8"/>
      <!-- now -->
      <rect x="86" y="70" width="2" height="24" rx="1" fill="#ff3b30"/>
      <circle cx="87" cy="72" r="3" fill="#ff3b30"/>
    </g>
  </svg>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, pad] of [["icon-512.png", 512, -5], ["icon-192.png", 192, -5], ["apple-touch-icon.png", 180, -5], ["icon-maskable-512.png", 512, 12]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, pad));
  await page.screenshot({ path: `public/icons/${name}`, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("public/icons/" + name);
}
await browser.close();
