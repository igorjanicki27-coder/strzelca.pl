const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(process.cwd(), 'data', 'bazar', 'pl-localities.min.json');

const VOIVODESHIPS = [
  { slug: 'dolnoslaskie', label: 'Dolnośląskie' },
  { slug: 'kujawsko-pomorskie', label: 'Kujawsko-Pomorskie' },
  { slug: 'lubelskie', label: 'Lubelskie' },
  { slug: 'lubuskie', label: 'Lubuskie' },
  { slug: 'lodzkie', label: 'Łódzkie' },
  { slug: 'malopolskie', label: 'Małopolskie' },
  { slug: 'mazowieckie', label: 'Mazowieckie' },
  { slug: 'opolskie', label: 'Opolskie' },
  { slug: 'podkarpackie', label: 'Podkarpackie' },
  { slug: 'podlaskie', label: 'Podlaskie' },
  { slug: 'pomorskie', label: 'Pomorskie' },
  { slug: 'slaskie', label: 'Śląskie' },
  { slug: 'swietokrzyskie', label: 'Świętokrzyskie' },
  { slug: 'warminsko-mazurskie', label: 'Warmińsko-Mazurskie' },
  { slug: 'wielkopolskie', label: 'Wielkopolskie' },
  { slug: 'zachodniopomorskie', label: 'Zachodniopomorskie' },
];

let cache = null;

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function ensureLoaded() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const localities = items.map((row) => ({
    id: String(row[0] || ''),
    name: String(row[1] || ''),
    normalized: String(row[2] || ''),
    wojewodztwo: String(row[3] || ''),
    wojewodztwoLabel: String(row[4] || ''),
    lat: Number(row[5] || 0),
    lng: Number(row[6] || 0),
    population: Number(row[7] || 0),
    searchText: String(row[8] || ''),
    label: `${String(row[1] || '')}, ${String(row[4] || '')}`,
  }));
  const byId = new Map(localities.map((item) => [item.id, item]));
  const createDefaults = [...localities]
    .sort((a, b) => (b.population - a.population) || a.name.localeCompare(b.name, 'pl'))
    .slice(0, 10);
  cache = {
    meta: raw?.meta || {},
    localities,
    byId,
    createDefaults,
    voivodeships: VOIVODESHIPS.map((item) => ({
      type: 'province',
      id: item.slug,
      slug: item.slug,
      label: item.label,
      wojewodztwo: item.slug,
      wojewodztwoLabel: item.label,
    })),
  };
  return cache;
}

function serializeLocality(item) {
  return {
    type: 'locality',
    id: item.id,
    name: item.name,
    label: item.label,
    wojewodztwo: item.wojewodztwo,
    wojewodztwoLabel: item.wojewodztwoLabel,
    lat: item.lat,
    lng: item.lng,
    population: item.population,
  };
}

function searchLocalities(query, limit = 12) {
  const state = ensureLoaded();
  const needle = normalizeSearchText(query);
  if (!needle) return [];
  const startsWith = [];
  const includes = [];
  state.localities.forEach((item) => {
    if (item.normalized.startsWith(needle)) startsWith.push(item);
    else if (`${item.searchText} ${normalizeSearchText(item.wojewodztwoLabel)}`.includes(needle)) includes.push(item);
  });
  const sorter = (a, b) => {
    if (b.population !== a.population) return b.population - a.population;
    return a.name.localeCompare(b.name, 'pl');
  };
  return [...startsWith.sort(sorter), ...includes.sort(sorter)]
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(serializeLocality);
}

function getLocationSuggestions({ query = '', scope = 'search', limit = 12 } = {}) {
  const state = ensureLoaded();
  const needle = normalizeSearchText(query);
  if (!needle) {
    if (scope === 'create') {
      return {
        suggestions: state.createDefaults.map(serializeLocality),
        mode: 'create_defaults',
      };
    }
    return {
      suggestions: state.voivodeships.slice(0, Math.max(1, Math.min(limit, 16))),
      mode: 'province_defaults',
    };
  }
  return {
    suggestions: searchLocalities(needle, limit),
    mode: 'locality_search',
  };
}

function getLocalityById(id) {
  if (!id) return null;
  const state = ensureLoaded();
  const item = state.byId.get(String(id));
  return item ? serializeLocality(item) : null;
}

function validateCreateLocationSelection(payload) {
  const locationId = String(payload?.locationId || '').trim();
  if (!locationId) throw new Error('Wybierz lokalizację z listy.');
  const locality = getLocalityById(locationId);
  if (!locality) throw new Error('Wybrana lokalizacja nie istnieje.');
  return locality;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLon = toRad(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = {
  VOIVODESHIPS,
  getLocationSuggestions,
  getLocalityById,
  validateCreateLocationSelection,
  haversineKm,
  normalizeSearchText,
};
