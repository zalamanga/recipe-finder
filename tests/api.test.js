import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanQuery, createClient, normalizeDetail, normalizeMeals, safeUrl } from '../src/api.js';

const meal = (extra = {}) => ({ idMeal: '52772', strMeal: 'Resep Contoh', strMealThumb: 'https://www.themealdb.com/images/media/meals/sample.jpg', ...extra });
const response = data => ({ ok: true, json: async () => data });

test('ingredient is encoded as one query parameter with spaces converted to underscores', async () => {
  let requested;
  const client = createClient(async url => { requested = new URL(url); return response({ meals: [] }); });
  await client.ingredient(' chicken breast&other=value ');
  assert.equal(requested.pathname, '/api/json/v1/1/filter.php');
  assert.equal(requested.searchParams.get('i'), 'chicken_breast&other=value');
  assert.deepEqual([...requested.searchParams.keys()], ['i']);
});
test('category uses the supplied category rather than a hardcoded Beef value', async () => {
  let requested;
  const client = createClient(async url => { requested = new URL(url); return response({ meals: [meal()] }); });
  const meals = await client.category('Seafood');
  assert.equal(requested.searchParams.get('c'), 'Seafood');
  assert.equal(meals[0].id, '52772');
});
test('empty, oversized and control-character input fails before a request', async () => {
  let calls = 0;
  const client = createClient(async () => { calls++; return response({ meals: [] }); });
  for (const value of ['', ' ', 'x'.repeat(81), 'chicken\nbeef']) await assert.rejects(client.ingredient(value), { code: 'input' });
  assert.equal(calls, 0);
  assert.equal(cleanQuery(' rice '), 'rice');
});
test('null results are empty and duplicate IDs do not create duplicate result cards', () => {
  assert.deepEqual(normalizeMeals({ meals: null }), []);
  assert.equal(normalizeMeals({ meals: [meal(), meal()] }).length, 1);
});
test('unexpected API shapes and invalid IDs fail clearly', () => {
  for (const payload of [{}, { meals: 'bad' }, { meals: [{}] }, { meals: [meal({ idMeal: '../x' })] }]) assert.throws(() => normalizeMeals(payload));
});
test('remote text stays as data and unsafe image/source URLs are excluded', () => {
  const result = normalizeDetail({ meals: [meal({ strMeal: '<img onerror=alert(1)>', strInstructions: '<script>alert(1)</script>', strYoutube: 'javascript:alert(1)', strSource: 'data:text/html,bad', strIngredient1: 'Rice', strMeasure1: '1 cup', strIngredient2: ' ' })] });
  assert.equal(result.name, '<img onerror=alert(1)>');
  assert.equal(result.instructions, '<script>alert(1)</script>');
  assert.equal(result.video, null);
  assert.equal(result.source, null);
  assert.deepEqual(result.ingredients, [{ ingredient: 'Rice', measure: '1 cup' }]);
});
test('image URLs must come from the API image host; links accept HTTP(S) without credentials', () => {
  for (const url of ['https://evil.example/photo.png', 'http://www.themealdb.com/images/x.jpg', 'https://www.themealdb.com.evil.example/images/x.jpg', 'javascript:alert(1)']) assert.equal(safeUrl(url, true), null);
  assert.equal(safeUrl('https://user:secret@example.com/a'), null);
  assert.equal(safeUrl('https://example.com/recipe'), 'https://example.com/recipe');
});
test('detail validates returned ID and missing recipe without silently showing another meal', async () => {
  await assert.rejects(createClient(async () => response({ meals: [meal({ idMeal: '123' })] })).detail('52772'), { code: 'format' });
  await assert.rejects(createClient(async () => response({ meals: null })).detail('52772'), { code: 'missing' });
  await assert.rejects(createClient(async () => response({ meals: [] })).detail('invalid'), { code: 'input' });
});
test('HTTP failure is distinct from empty search', async () => {
  const client = createClient(async () => ({ ok: false, status: 503 }));
  await assert.rejects(client.ingredient('rice'), error => error.code === 'http' && error.message.includes('503'));
});
test('network and JSON parsing errors are recoverable request errors', async () => {
  await assert.rejects(createClient(async () => { throw new TypeError('offline'); }).ingredient('rice'), { code: 'network' });
  await assert.rejects(createClient(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })).ingredient('rice'), { code: 'format' });
});
test('categories are validated and deduplicated', async () => {
  const names = await createClient(async () => response({ categories: [{ strCategory: 'Seafood' }, { strCategory: 'Seafood' }, { strCategory: 'Vegetarian' }] })).categories();
  assert.deepEqual(names, ['Seafood', 'Vegetarian']);
  await assert.rejects(createClient(async () => response({ categories: null })).categories(), { code: 'format' });
});
test('malformed category records return a domain error instead of a raw TypeError', async () => {
  for (const item of [null, 7, {}, { strCategory: '' }, { strCategory: 'bad\nvalue' }]) {
    await assert.rejects(createClient(async () => response({ categories: [item] })).categories(), error => error.code === 'format' && error.message === 'Format kategori dari API tidak sesuai.');
  }
});
function abortingFetch(_, { signal }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}
test('timeout aborts the request rather than leaving loading forever', async () => {
  await assert.rejects(createClient(abortingFetch, 5).ingredient('rice'), { code: 'timeout' });
});
test('external cancellation is distinguishable from API/network failure', async () => {
  const controller = new AbortController();
  const promise = createClient(abortingFetch).ingredient('rice', controller.signal);
  controller.abort();
  await assert.rejects(promise, { code: 'cancelled' });
});
