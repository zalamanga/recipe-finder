const BASE = 'https://www.themealdb.com/api/json/v1/1/';
export class RecipeError extends Error {
  constructor(message, code = 'request') { super(message); this.code = code; }
}
export function cleanQuery(value, label = 'Bahan') {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw new RecipeError(`${label} tidak valid.`, 'input');
  const result = value.trim();
  if (!result || result.length > 80) throw new RecipeError(`${label} wajib diisi, maksimal 80 karakter.`, 'input');
  return result;
}
export function safeUrl(value, image = false) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (image && (url.protocol !== 'https:' || !['www.themealdb.com', 'themealdb.com'].includes(url.hostname) || !url.pathname.startsWith('/images/'))) return null;
    return url.href;
  } catch { return null; }
}
function summary(value) {
  if (!value || !/^\d{1,12}$/u.test(String(value.idMeal)) || typeof value.strMeal !== 'string' || !value.strMeal.trim()) throw new RecipeError('Format resep dari API tidak sesuai.', 'format');
  return { id: String(value.idMeal), name: value.strMeal.trim().slice(0, 250), image: safeUrl(value.strMealThumb, true) };
}
export function normalizeMeals(data) {
  if (!data || !Object.hasOwn(data, 'meals') || (data.meals !== null && !Array.isArray(data.meals))) throw new RecipeError('Format daftar resep dari API tidak sesuai.', 'format');
  const values = data.meals || [];
  if (values.length > 1000) throw new RecipeError('Daftar resep terlalu besar.', 'format');
  const meals = values.map(summary);
  return [...new Map(meals.map(meal => [meal.id, meal])).values()];
}
export function normalizeDetail(data) {
  const meals = normalizeMeals(data);
  if (!meals.length) throw new RecipeError('Detail resep tidak ditemukan. Pilih resep lain.', 'missing');
  const raw = data.meals[0];
  const ingredients = [];
  for (let index = 1; index <= 20; index++) {
    const ingredient = String(raw[`strIngredient${index}`] || '').trim();
    const measure = String(raw[`strMeasure${index}`] || '').trim();
    if (ingredient) ingredients.push({ ingredient: ingredient.slice(0, 200), measure: measure.slice(0, 200) });
  }
  return { ...meals[0], category: String(raw.strCategory || ''), area: String(raw.strArea || ''), instructions: String(raw.strInstructions || '').trim(), ingredients, video: safeUrl(raw.strYoutube), source: safeUrl(raw.strSource) };
}
export function createClient(fetcher = fetch, timeoutMs = 10_000) {
  async function request(endpoint, params = {}, signal) {
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort();
    if (signal?.aborted) forwardAbort(); else signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const url = new URL(endpoint, BASE);
    url.search = new URLSearchParams(params).toString();
    try {
      const response = await fetcher(url.href, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new RecipeError(`TheMealDB belum dapat melayani permintaan (HTTP ${response.status}). Coba lagi.`, 'http');
      try { return await response.json(); } catch { throw new RecipeError('Respons API tidak dapat dibaca. Coba lagi.', 'format'); }
    } catch (error) {
      if (signal?.aborted) throw new RecipeError('Permintaan dibatalkan.', 'cancelled');
      if (timedOut) throw new RecipeError('Permintaan terlalu lama. Periksa koneksi lalu coba lagi.', 'timeout');
      if (error instanceof RecipeError) throw error;
      throw new RecipeError('Resep belum dapat dimuat. Periksa koneksi internet lalu coba lagi.', 'network');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
  return {
    async categories(signal) {
      const data = await request('categories.php', {}, signal);
      if (!Array.isArray(data?.categories) || data.categories.length > 100) throw new RecipeError('Format kategori dari API tidak sesuai.', 'format');
      const categories = data.categories.map(item => {
        if (!item || typeof item.strCategory !== 'string') throw new RecipeError('Format kategori dari API tidak sesuai.', 'format');
        try { return cleanQuery(item.strCategory, 'Kategori'); }
        catch { throw new RecipeError('Format kategori dari API tidak sesuai.', 'format'); }
      });
      return [...new Set(categories)];
    },
    async ingredient(value, signal) { return normalizeMeals(await request('filter.php', { i: cleanQuery(value).replace(/\s+/gu, '_') }, signal)); },
    async category(value, signal) { return normalizeMeals(await request('filter.php', { c: cleanQuery(value, 'Kategori') }, signal)); },
    async detail(id, signal) {
      if (!/^\d{1,12}$/u.test(String(id))) throw new RecipeError('ID resep tidak valid.', 'input');
      const detail = normalizeDetail(await request('lookup.php', { i: id }, signal));
      if (detail.id !== String(id)) throw new RecipeError('API mengembalikan detail resep yang berbeda.', 'format');
      return detail;
    },
  };
}
