/**
 * Requires: npm run dev on :3001, playwright chromium installed (npx playwright install chromium)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'screenshots');
mkdirSync(outDir, { recursive: true });

const base = 'http://127.0.0.1:3001/';

async function goMusicAndPickRow(page, searchText) {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: /music|音乐|曲库/i }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const search = page.locator('input[type="search"], input[placeholder*="Search"], input').first();
  if (await search.count()) {
    await search.fill(searchText);
    await page.waitForTimeout(800);
  }
  const row = page.getByText(searchText, { exact: false }).first();
  await row.click({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

try {
  await goMusicAndPickRow(page, 'After LIKE');
  await page.screenshot({
    path: path.join(outDir, 'player-linked-video-and-sheet.png'),
    fullPage: false,
  });

  await goMusicAndPickRow(page, 'a thousand years');
  await page.screenshot({
    path: path.join(outDir, 'player-video-only-missing-sheet.png'),
    fullPage: false,
  });

  console.log('Wrote', path.join(outDir, 'player-linked-video-and-sheet.png'));
  console.log('Wrote', path.join(outDir, 'player-video-only-missing-sheet.png'));
} finally {
  await browser.close();
}
