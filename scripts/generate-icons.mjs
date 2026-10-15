// Renders public/favicon.svg into the PNG icons needed by the PWA manifest, iOS and the
// Capacitor native projects (resources/icon.png, resources/splash.png).
// Usage: node scripts/generate-icons.mjs   (needs a Chromium; set CHROMIUM_PATH if not at /opt/pw-browsers)
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
const BG = process.env.ICON_BG ?? '#f3eee3';

async function render(file, size, { padding = 0, bg = 'transparent', canvas = size } = {}) {
  const inner = size - padding * 2;
  await page.setViewportSize({ width: canvas, height: canvas });
  await page.setContent(
    `<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${canvas}px;height:${canvas}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: bg === 'transparent' });
  console.log('wrote', file);
}

await mkdir('public/icons', { recursive: true });
await mkdir('resources', { recursive: true });
await render('public/icons/icon-192.png', 192);
await render('public/icons/icon-512.png', 512);
await render('public/icons/maskable-512.png', 512, { padding: 64, bg: BG });
await render('public/icons/apple-touch-icon.png', 180, { padding: 0, bg: BG });
await render('resources/icon.png', 1024, { bg: BG });
await render('resources/icon-foreground.png', 1024, { padding: 260 });
await render('resources/splash.png', 2732, { padding: 1100, bg: process.env.SPLASH_BG ?? '#f3eee3' });
await render('resources/splash-dark.png', 2732, { padding: 1100, bg: process.env.SPLASH_DARK_BG ?? '#1b1d22' });
await browser.close();
