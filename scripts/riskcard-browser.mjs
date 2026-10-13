import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const directory = await mkdtemp(join(tmpdir(), 'riskcard-browser-'));
const browser = await chromium.launch({ headless: true });
const output = resolve('output/browser');
await mkdir(output, { recursive: true });
try {
  await promisify(execFile)(process.execPath, ['scripts/riskcard-demo.mjs', directory]);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const locale of ['fr', 'en', 'es']) {
    await page.goto(pathToFileURL(join(directory, locale + '.html')).href);
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    assert.equal(await page.locator('tbody tr').count(), 2);
    assert.equal(await page.locator('script').count(), 0);
    assert.ok((await page.locator('#riskcard-status').textContent()).trim());
    assert.equal(
      await page.locator('.metric strong').first().textContent(),
      locale === 'en' ? '80%' : '80 %',
    );
    await page.screenshot({ path: join(output, locale + '.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: join(output, locale + '-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  assert.deepEqual(errors, []);
  console.log(
    'FR : RiskCard vérifiée dans les trois langues. EN: RiskCard verified in all three languages. ES: RiskCard verificada en los tres idiomas.',
  );
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
