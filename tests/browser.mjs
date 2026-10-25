import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportDir = process.env.QA_REPORT_DIR || resolve(root, 'test-results');
const captureDir = process.env.CAPTURE_README === '1' ? resolve(root, 'docs/images') : reportDir;
await mkdir(reportDir, { recursive: true });
await mkdir(captureDir, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep) || pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpeg': 'image/jpeg' })[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--disable-gpu'] });
} catch (error) {
  await new Promise(resolve => server.close(resolve));
  throw error;
}
const checks = [];
const pageErrors = [];
const check = async (name, action) => { await action(); checks.push({ name, pass: true }); };
const fixture = id => ({ idMeal: String(id), strMeal: id === 1 ? '<img src=x onerror=alert(1)>' : 'Resep contoh kedua', strMealThumb: id === 1 ? 'https://www.themealdb.com/images/media/meals/missing-test.jpg' : null, strCategory: 'Seafood', strArea: 'Fixture uji', strInstructions: 'Langkah contoh untuk pengujian.\nBukan petunjuk resep produksi.', strIngredient1: 'Bahan contoh', strMeasure1: '1 bagian', strYoutube: 'https://www.youtube.com/watch?v=example', strSource: 'https://example.com/recipe' });
let mode = 'success';
let detailMode = 'success';
let categoryMode = 'success';
let lastFilter = null;
let releaseSlow;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(/https:\/\/(?:www\.youtube\.com|example\.com)\//u, route => route.fulfill({ contentType: 'text/html', body: '<title>External navigation test fixture</title>' }));
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('https://www.themealdb.com/**', async route => {
    const request = new URL(route.request().url());
    const json = data => route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': '*' } });
    if (request.pathname.endsWith('categories.php')) {
      if (categoryMode === 'fail') return route.fulfill({ status: 503, body: 'unavailable', headers: { 'Access-Control-Allow-Origin': '*' } });
      return json({ categories: [{ strCategory: 'Seafood' }, { strCategory: 'Vegetarian' }, { strCategory: 'Vegan' }] });
    }
    if (request.pathname.endsWith('lookup.php')) {
      if (detailMode === 'fail') return route.fulfill({ status: 503, body: 'unavailable', headers: { 'Access-Control-Allow-Origin': '*' } });
      if (detailMode === 'empty') return json({ meals: null });
      return json({ meals: [fixture(Number(request.searchParams.get('i')))] });
    }
    if (request.pathname.endsWith('filter.php')) {
      lastFilter = Object.fromEntries(request.searchParams);
      if (mode === 'fail') return route.fulfill({ status: 503, body: 'unavailable', headers: { 'Access-Control-Allow-Origin': '*' } });
      if (mode === 'empty') return json({ meals: null });
      if (request.searchParams.get('i') === 'slow') {
        await new Promise(resolve => { releaseSlow = resolve; });
        try { return await json({ meals: [{ ...fixture(3), strMeal: 'STALE RESULT' }] }); } catch { return; }
      }
      return json({ meals: [fixture(1), fixture(2)] });
    }
    return route.abort();
  });
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('category').disabled);
  await check('empty prompt, required input, navigation and category options', async () => {
    assert.equal(await page.locator('.meal-card').count(), 0);
    await page.getByRole('link', { name: 'Cari bahan', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#search');
    await page.locator('#ingredient-form button').click();
    assert.equal(await page.locator('#ingredient').evaluate(el => el.validity.valueMissing), true);
    await page.getByRole('link', { name: 'Kategori', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#categories');
    assert.equal(await page.locator('#category option').count(), 4);
  });
  await check('encoded ingredient request, results and safe remote text rendering', async () => {
    await page.locator('#ingredient').fill('chicken breast&extra=value');
    await page.locator('#ingredient-form button').click();
    await page.locator('.meal-card').nth(1).waitFor();
    assert.deepEqual(lastFilter, { i: 'chicken_breast&extra=value' });
    assert.equal(await page.locator('.meal-card h3').first().textContent(), '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('.meal-card h3 img').count(), 0);
    assert.equal(await page.locator('.image-fallback').count(), 2);
  });
  await check('detail ingredients/instructions/source/video, Escape and return focus', async () => {
    const trigger = page.locator('.meal-card button').first();
    await trigger.click();
    await page.locator('#recipe-detail .ingredients').waitFor();
    assert.equal(await page.locator('.ingredients li').textContent(), '1 bagian Bahan contoh');
    assert.equal(await page.locator('#recipe-detail script').count(), 0);
    for (const link of await page.locator('.recipe-links a').all()) {
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      assert.match(await link.getAttribute('href'), /^https:\/\//u);
      const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
      await popup.waitForLoadState();
      assert.equal(popup.url(), await link.getAttribute('href'));
      await popup.close();
    }
    await page.keyboard.press('Escape');
    await page.locator('#recipe-dialog').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  });
  await check('detail HTTP error and missing record recover through retry; close button works', async () => {
    detailMode = 'fail';
    await page.locator('.meal-card button').first().click();
    await page.locator('#retry-detail').waitFor();
    detailMode = 'empty';
    await page.locator('#retry-detail').click();
    await page.getByText('Detail resep tidak ditemukan. Pilih resep lain.', { exact: true }).waitFor();
    detailMode = 'success';
    await page.locator('#retry-detail').click();
    await page.locator('#recipe-detail .ingredients').waitFor();
    await page.locator('#close-recipe').click();
  });
  await check('selected category and legacy category URL honor query, browser back restores filter', async () => {
    await page.locator('#category').selectOption('Vegetarian');
    await page.locator('#browse-category').click();
    await page.locator('.meal-card').nth(1).waitFor();
    assert.deepEqual(lastFilter, { c: 'Vegetarian' });
    assert.equal(new URL(page.url()).searchParams.get('category'), 'Vegetarian');
    await page.goto(`${url}/category.html?category=Seafood`);
    await page.waitForURL('**/index.html?category=Seafood');
    await page.locator('.meal-card').nth(1).waitFor();
    assert.deepEqual(lastFilter, { c: 'Seafood' });
    await page.locator('#category').selectOption('Vegan');
    await page.locator('#browse-category').click();
    await page.locator('.meal-card').nth(1).waitFor();
    await page.goBack();
    await page.waitForFunction(() => document.getElementById('results-title').textContent === 'Kategori: Seafood');
    assert.deepEqual(lastFilter, { c: 'Seafood' });
  });
  await check('result HTTP error and empty response have real recovery and clear action', async () => {
    mode = 'fail';
    await page.locator('#ingredient').fill('rice');
    await page.locator('#ingredient-form button').click();
    await page.locator('#retry-results').waitFor();
    mode = 'empty';
    await page.locator('#retry-results').click();
    await page.getByText('Tidak ada resep yang cocok. Coba nama bahan lain atau pilih kategori.', { exact: true }).waitFor();
    assert.equal(await page.locator('.meal-card').count(), 0);
    mode = 'success';
    await page.locator('#reset-results').click();
    assert.equal(await page.locator('#ingredient').inputValue(), '');
    assert.equal(new URL(page.url()).search, '');
  });
  await check('new search cancels stale request and loading is visible while request waits', async () => {
    await page.locator('#ingredient').fill('slow');
    await page.locator('#ingredient-form button').click();
    await page.waitForFunction(() => document.getElementById('meal-list').getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('#result-status').textContent(), 'Mengambil resep dari TheMealDB…');
    await page.locator('#ingredient').fill('rice');
    await page.locator('#ingredient-form button').click();
    await page.locator('.meal-card').nth(1).waitFor();
    releaseSlow?.();
    await page.waitForFunction(() => document.getElementById('meal-list').getAttribute('aria-busy') === 'false');
    assert.equal(await page.getByText('STALE RESULT', { exact: true }).count(), 0);
  });
  await check('category outage retries instead of freezing controls', async () => {
    categoryMode = 'fail';
    await page.reload();
    await page.locator('#retry-categories').waitFor();
    assert.equal(await page.locator('#category').isDisabled(), true);
    categoryMode = 'success';
    await page.locator('#retry-categories').click();
    await page.waitForFunction(() => !document.getElementById('category').disabled);
  });
  await check('responsive widths, tap targets, keyboard and 200 percent short dialog reflow', async () => {
    for (const width of [360, 600, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width}`);
      const heights = await page.locator('button:visible, input:visible, select:visible').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
      assert.equal(heights.every(h => h >= 44), true);
    }
    await page.setViewportSize({ width: 360, height: 480 });
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, JSON.stringify(await page.locator('body *').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().right > innerWidth).map(n => n.tagName+'.'+n.className))));
    await page.locator('.meal-card button').first().click();
    await page.locator('#recipe-detail .ingredients').waitFor();
    assert.equal(await page.locator('#recipe-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.locator('#close-recipe').scrollIntoViewIfNeeded();
    await page.keyboard.press('Escape');
    await page.goto(url);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'results');
    await page.locator('#ingredient').focus();
    assert.notEqual(await page.locator('#ingredient').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.type('rice');
    await page.keyboard.press('Enter');
    await page.locator('.meal-card').nth(1).waitFor();
  });
  assert.deepEqual(pageErrors, []);
  await context.close();
  let live = { status: 'NOT_RUN', reason: 'Set LIVE_API=1 to perform read-only public API smoke and capture real recipe screenshots.' };
  if (process.env.LIVE_API === '1') {
    const liveContext = await browser.newContext({ viewport: { width: 1440, height: 1150 } });
    const livePage = await liveContext.newPage();
    const responses = [];
    livePage.on('pageerror', error => pageErrors.push(error.message));
    livePage.on('response', response => { if (response.url().includes('/api/json/')) responses.push({ url: response.url(), status: response.status() }); });
    await livePage.goto(`${url}/?category=Vegan`);
    await livePage.locator('.meal-card').first().waitFor({ timeout: 20000 });
    await livePage.waitForFunction(() => !document.getElementById('category').disabled);
    await livePage.locator('.meal-card img').first().waitFor();
    await livePage.locator('.meal-card img').first().evaluate(img => img.decode());
    for (const image of await livePage.locator('.meal-card img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(img => new Promise(resolve => {
        if (img.complete) resolve();
        else { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 8000); }
      }));
    }
    await livePage.evaluate(() => window.scrollTo(0, 0));
    await livePage.screenshot({ path: resolve(captureDir, 'recipes-desktop.png'), fullPage: true });
    const title = await livePage.locator('.meal-card h3').first().textContent();
    await livePage.locator('.meal-card button').first().click();
    await livePage.locator('#recipe-detail .ingredients').waitFor({ timeout: 20000 });
    await livePage.screenshot({ path: resolve(captureDir, 'recipe-detail.png'), fullPage: false });
    await livePage.locator('#close-recipe').click();
    await livePage.setViewportSize({ width: 360, height: 850 });
    await livePage.locator('#results').scrollIntoViewIfNeeded();
    await livePage.screenshot({ path: resolve(captureDir, 'recipes-mobile.png'), fullPage: false });
    live = { status: 'PASS', category: 'Vegan', meals: await livePage.locator('.meal-card').count(), firstMeal: title, responses, screenshotData: 'Actual live TheMealDB responses/photos; no mocked API in this browser context.' };
    await liveContext.close();
  }
  assert.deepEqual(pageErrors, []);
  await writeFile(resolve(reportDir, 'browser-results.json'), JSON.stringify({ status: 'PASS', checks, pageErrors, fixtureNote: 'Deterministic adversarial recipe fixtures are used only by tests; screenshots use separate live context when LIVE_API=1.', live }, null, 2));
  console.log(`PASS ${checks.length} browser scenarios; live API ${live.status}; page errors 0`);
} finally {
  releaseSlow?.();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
