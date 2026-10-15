// Captures README screenshots with real OpenStreetMap data. Run after `npm run build`.
//   npm run screenshots              # live Overpass data (cached by the app in IndexedDB per run)
//   FIXTURE=1 npm run screenshots    # synthetic city, when the Overpass servers are unavailable
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { syntheticCity } from './synthetic-city.mjs';

const server = await preview({ preview: { port: 4191, strictPort: true }, logLevel: 'silent' });
const base = 'http://localhost:4191/';
// Pass the proxy straight to Chromium so localhost (the preview server) can bypass it.
const proxyArgs = process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...proxyArgs],
});
await mkdir('docs/screenshots', { recursive: true });
await mkdir('public/screenshots', { recursive: true });

async function shot({ name, query, width = 1440, height = 900, dpr = 1, mobile = false, city = true, before }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  if (process.env.FIXTURE) {
    const params = new URLSearchParams(query);
    const body = JSON.stringify(syntheticCity(Number(params.get('lat') ?? 40.7075), Number(params.get('lng') ?? -74.0113)));
    await page.route(/interpreter/, (r) => r.fulfill({ contentType: 'application/json', body }));
  }
  await page.goto(base + query);
  if (city) {
    await page.waitForFunction(() => document.body.dataset.mode === 'city', null, { timeout: 240_000 });
    await page.waitForTimeout(2500); // camera swoop
  } else {
    await page.waitForTimeout(12_000); // tiles stream in
  }
  if (before) await before(page);
  await page.waitForTimeout(800);
  for (const path of [].concat(name)) await page.screenshot({ path });
  console.log('wrote', name, '-', await page.textContent('#stats'));
  await ctx.close();
}

const collapse = async (page) => {
  if ((await page.getAttribute('#panel-toggle', 'aria-expanded')) === 'true') await page.click('#panel-toggle');
};

await shot({ name: 'docs/screenshots/globe-pencil.png', query: '', city: false });
await shot({ name: 'docs/screenshots/globe-blueprint-mobile.png', query: '?style=blueprint', width: 390, height: 844, dpr: 2, mobile: true, city: false });
await shot({ name: ['docs/screenshots/manhattan-pencil.png', 'public/screenshots/desktop.png'], query: '?preset=manhattan' });
await shot({ name: 'docs/screenshots/paris-charcoal.png', query: '?preset=paris&style=charcoal' });
await shot({ name: 'docs/screenshots/shibuya-blueprint.png', query: '?preset=shibuya&style=blueprint' });
await shot({ name: 'docs/screenshots/vizag-pencil.png', query: '?preset=vizag' });
await shot({ name: ['docs/screenshots/mobile-pencil.png', 'public/screenshots/mobile.png'], query: '?preset=paris', width: 390, height: 844, dpr: 2, mobile: true });
await shot({ name: 'public/og-image.png', query: '?preset=manhattan', width: 1200, height: 630, before: collapse });

await browser.close();
await server.close();
