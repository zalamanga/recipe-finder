import { cleanQuery, createClient } from './api.js';

const $ = id => document.getElementById(id);
const client = createClient();
let resultController = null;
let detailController = null;
let currentFilter = null;
let currentMeal = null;
let opener = null;

function imageFor(src, name, className = '') {
  if (!src) {
    const fallback = document.createElement('div');
    fallback.className = 'image-fallback';
    fallback.textContent = 'Gambar tidak tersedia';
    return fallback;
  }
  const image = document.createElement('img');
  image.src = src;
  image.alt = name;
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  if (className) image.className = className;
  image.addEventListener('error', () => image.replaceWith(imageFor(null, name)), { once: true });
  return image;
}
function paragraph(text, className = '') {
  const p = document.createElement('p');
  p.textContent = text;
  p.className = className;
  return p;
}
async function loadCategories() {
  $('retry-categories').hidden = true;
  $('category-status').textContent = 'Mengambil daftar kategori…';
  $('category').disabled = true;
  $('browse-category').disabled = true;
  try {
    const categories = await client.categories();
    const placeholder = new Option('Pilih kategori masakan', '');
    $('category').replaceChildren(placeholder, ...categories.map(name => new Option(name, name)));
    if (currentFilter?.type === 'category' && categories.includes(currentFilter.value)) $('category').value = currentFilter.value;
    $('category-status').textContent = categories.length ? 'Pilih satu kategori lalu tekan Lihat resep.' : 'Belum ada kategori dari API.';
    $('category').disabled = !categories.length;
    $('browse-category').disabled = !categories.length;
  } catch (error) {
    $('category-status').textContent = error.message;
    $('retry-categories').hidden = false;
  }
}
function cardFor(meal) {
  const article = document.createElement('article');
  article.className = 'meal-card';
  const title = document.createElement('h3');
  title.textContent = meal.name;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Lihat resep';
  button.setAttribute('aria-label', `Lihat resep ${meal.name}`);
  button.addEventListener('click', () => openDetail(meal.id, meal.name, button));
  article.append(imageFor(meal.image, meal.name), title, button);
  return article;
}
function writeLocation(filter) {
  const url = new URL(window.location.href);
  url.search = new URLSearchParams(filter ? { [filter.type]: filter.value } : {}).toString();
  history.pushState(null, '', url);
}
async function loadResults(filter, updateLocation = true) {
  try { filter = { type: filter.type, value: cleanQuery(filter.value, filter.type === 'category' ? 'Kategori' : 'Bahan') }; }
  catch (error) { $('input-error').textContent = error.message; $('input-error').hidden = false; return; }
  $('input-error').hidden = true;
  resultController?.abort();
  const controller = new AbortController();
  resultController = controller;
  currentFilter = filter;
  if (updateLocation) writeLocation(filter);
  $('reset-results').hidden = false;
  $('retry-results').hidden = true;
  $('meal-list').replaceChildren();
  $('meal-list').setAttribute('aria-busy', 'true');
  $('results-title').textContent = filter.type === 'category' ? `Kategori: ${filter.value}` : `Bahan utama: ${filter.value}`;
  $('result-status').textContent = 'Mengambil resep dari TheMealDB…';
  try {
    const meals = await client[filter.type](filter.value, controller.signal);
    if (controller !== resultController) return;
    $('meal-list').replaceChildren(...meals.map(cardFor));
    $('result-status').textContent = meals.length ? `${meals.length} resep ditemukan. Pilih Lihat resep untuk bahan dan petunjuk.` : 'Tidak ada resep yang cocok. Coba nama bahan lain atau pilih kategori.';
  } catch (error) {
    if (controller !== resultController || error.code === 'cancelled') return;
    $('result-status').textContent = error.message;
    $('retry-results').hidden = false;
  } finally {
    if (controller === resultController) $('meal-list').setAttribute('aria-busy', 'false');
  }
}
function renderDetail(detail) {
  $('recipe-title').textContent = detail.name;
  const nodes = [paragraph([detail.category, detail.area].filter(Boolean).join(' · ')), imageFor(detail.image, detail.name, 'recipe-photo')];
  const ingredientsTitle = document.createElement('h3');
  ingredientsTitle.textContent = 'Bahan dan takaran';
  nodes.push(ingredientsTitle);
  const ingredients = document.createElement('ul');
  ingredients.className = 'ingredients';
  for (const item of detail.ingredients) {
    const row = document.createElement('li');
    row.textContent = [item.measure, item.ingredient].filter(Boolean).join(' ');
    ingredients.append(row);
  }
  nodes.push(detail.ingredients.length ? ingredients : paragraph('Bahan belum tersedia pada sumber resep.'));
  const instructionsTitle = document.createElement('h3');
  instructionsTitle.textContent = 'Cara memasak';
  nodes.push(instructionsTitle, paragraph(detail.instructions || 'Petunjuk memasak belum tersedia pada sumber resep.', 'instructions'));
  const links = document.createElement('div');
  links.className = 'recipe-links';
  for (const [href, label] of [[detail.video, 'Tonton video'], [detail.source, 'Buka sumber resep']]) {
    if (!href) continue;
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = `${label} (tab baru)`;
    links.append(anchor);
  }
  nodes.push(links);
  $('recipe-detail').replaceChildren(...nodes);
}
async function loadDetail() {
  detailController?.abort();
  const controller = new AbortController();
  detailController = controller;
  $('recipe-detail').replaceChildren();
  $('retry-detail').hidden = true;
  $('detail-status').textContent = 'Mengambil bahan dan petunjuk memasak…';
  $('recipe-detail').setAttribute('aria-busy', 'true');
  try {
    const detail = await client.detail(currentMeal, controller.signal);
    if (controller !== detailController || !$('recipe-dialog').open) return;
    renderDetail(detail);
    $('detail-status').textContent = 'Detail resep dari TheMealDB.';
  } catch (error) {
    if (controller !== detailController || error.code === 'cancelled') return;
    $('detail-status').textContent = error.message;
    $('retry-detail').hidden = false;
  } finally {
    if (controller === detailController) $('recipe-detail').setAttribute('aria-busy', 'false');
  }
}
function openDetail(id, name, button) {
  currentMeal = id;
  opener = button;
  $('recipe-title').textContent = name;
  $('recipe-dialog').showModal();
  $('close-recipe').focus();
  loadDetail();
}
function clearResults(updateLocation = true) {
  resultController?.abort();
  resultController = null;
  currentFilter = null;
  $('ingredient').value = '';
  if (!$('category').disabled) $('category').value = '';
  $('results-title').textContent = 'Resep untuk dicoba';
  $('meal-list').replaceChildren();
  $('meal-list').setAttribute('aria-busy', 'false');
  $('result-status').textContent = 'Cari satu bahan atau pilih kategori untuk melihat resep.';
  $('input-error').hidden = true;
  $('retry-results').hidden = true;
  $('reset-results').hidden = true;
  if (updateLocation) writeLocation(null);
}
function loadFromLocation() {
  const params = new URLSearchParams(location.search);
  const category = params.get('category');
  const ingredient = params.get('ingredient');
  if (category) {
    $('category').value = category;
    loadResults({ type: 'category', value: category }, false);
  } else if (ingredient) {
    $('ingredient').value = ingredient;
    loadResults({ type: 'ingredient', value: ingredient }, false);
  } else clearResults(false);
}
$('ingredient-form').addEventListener('submit', event => { event.preventDefault(); loadResults({ type: 'ingredient', value: $('ingredient').value }); });
$('category-form').addEventListener('submit', event => { event.preventDefault(); loadResults({ type: 'category', value: $('category').value }); });
$('retry-categories').addEventListener('click', loadCategories);
$('retry-results').addEventListener('click', () => { if (currentFilter) loadResults(currentFilter, false); });
$('reset-results').addEventListener('click', () => { clearResults(); $('ingredient').focus(); });
$('close-recipe').addEventListener('click', () => $('recipe-dialog').close());
$('retry-detail').addEventListener('click', loadDetail);
$('recipe-dialog').addEventListener('close', () => { detailController?.abort(); detailController = null; opener?.focus(); });
window.addEventListener('popstate', loadFromLocation);
loadFromLocation();
loadCategories();
