// Lugares de pago y viajes, a partir de la localidad que trae el extracto.
import { dayDiff } from './store.js';

const COUNTRIES = {
  ES: 'España', PT: 'Portugal', FR: 'Francia', IT: 'Italia', GB: 'Reino Unido', UK: 'Reino Unido', IE: 'Irlanda',
  NL: 'Países Bajos', BE: 'Bélgica', CH: 'Suiza', AD: 'Andorra', AT: 'Austria', GR: 'Grecia', US: 'Estados Unidos',
  MX: 'México', MA: 'Marruecos', PL: 'Polonia', CZ: 'Chequia', HU: 'Hungría', DK: 'Dinamarca', SE: 'Suecia', NO: 'Noruega',
};
// El banco corta los nombres largos: equivalencias conocidas.
const FULL_NAMES = {
  'carbajosa de': 'Carbajosa de la Sagrada',
  'florida de lies': 'Florida de Liébana',
  'santa marta de': 'Santa Marta de Tormes',
  'villamayor de': 'Villamayor',
  'villares de la': 'Villares de la Reina',
  'cabrerizos': 'Cabrerizos',
};
// Comercios online aunque el extracto los marque como compra con tarjeta.
const ONLINE = /amazon|tiktok|aliexpress|shein|paypal|steam|netflix|spotify|google|apple\.com|playstation|nintendo|microsoft|ebay|temu|rotmg/i;

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const pretty = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/ (De|Del|La|Las|Los|El|Y)(?= )/g, (w) => w.toLowerCase());

const cache = new Map();
// { key, name, country, countryName, online } o null si el movimiento no trae lugar.
export function placeOf(m) {
  if (!m || m.amount >= 0 || !m.desc) return null;
  if (cache.has(m.desc)) return cache.get(m.desc);
  let info = null;
  const k = m.desc.match(/^(Pago Movil En|Compra Internet En|Compra En|Compra(?! Bizum)) (.+)$/i);
  if (k) {
    const parts = k[2].split(',').map((s) => s.trim()).filter(Boolean);
    let place = (parts[1] || '').replace(/\s*\(.*$/, '').trim();
    let country = 'ES';
    const tokens = place.split(' ');
    const last = tokens[tokens.length - 1].toUpperCase();
    if (tokens.length > 1 && last.length === 2 && COUNTRIES[last]) { country = last; tokens.pop(); place = tokens.join(' '); }
    if (place) {
      const name = FULL_NAMES[norm(place)] || pretty(place);
      const online = /Internet/i.test(k[1]) || /^Compra$/i.test(k[1]) || ONLINE.test(parts[0] || '');
      info = { key: norm(name), name, country, countryName: COUNTRIES[country], online };
    }
  }
  cache.set(m.desc, info);
  return info;
}

const homeSet = (db) => new Set(db.settings.home || []);
export const isHome = (db, info) => !!info && homeSet(db).has(info.key);

// Gasto agrupado por lugar (sin compras online).
export function placeStats(db) {
  const map = new Map();
  for (const m of db.movements) {
    const p = placeOf(m);
    if (!p || p.online) continue;
    const s = map.get(p.key) || { ...p, total: 0, n: 0, days: new Set() };
    s.total -= m.amount;
    s.n++;
    s.days.add(m.date);
    map.set(p.key, s);
  }
  return [...map.values()].map((s) => ({ ...s, days: s.days.size, home: isHome(db, s) })).sort((a, b) => b.total - a.total);
}

// Propuesta inicial de "tu zona": la ciudad escrita y los sitios donde pagas a menudo.
export function suggestHome(db, city) {
  const c = norm(city);
  return placeStats(db).filter((s) => s.key === c || s.days >= 3).map((s) => s.key);
}

// Gastos que cuentan en un viaje: fuera de tu zona o sin lugar (Bizum, efectivo, avisos),
// sin compras online, ahorro ni facturas de casa.
export function tripMovs(db, t) {
  return db.movements.filter((m) => {
    if (m.amount >= 0 || m.date < t.from || m.date > t.to) return false;
    if (m.cat === 'ahorro' || m.cat === 'hogar') return false;
    const p = placeOf(m);
    return !(p && (p.online || isHome(db, p)));
  });
}

export function tripSummary(db, t) {
  const movs = tripMovs(db, t);
  const byCat = {};
  const byPlace = {};
  for (const m of movs) {
    byCat[m.cat] = (byCat[m.cat] || 0) - m.amount;
    const p = placeOf(m);
    const name = p ? p.name + (p.country !== 'ES' ? ` (${p.countryName})` : '') : 'Sin lugar (Bizum, efectivo…)';
    byPlace[name] = (byPlace[name] || 0) - m.amount;
  }
  return { movs, total: -movs.reduce((a, m) => a + m.amount, 0), byCat, byPlace, days: dayDiff(t.from, t.to) + 1 };
}

// Agrupa pagos seguidos fuera de tu zona en posibles viajes.
export function detectTrips(db) {
  if (!db.settings.home?.length) return [];
  const exp = db.movements.filter((m) => m.amount < 0).map((m) => ({ m, p: placeOf(m) })).filter((x) => x.p && !x.p.online);
  const homeDays = [...new Set(exp.filter((x) => isHome(db, x.p)).map((x) => x.m.date))];
  const away = exp.filter((x) => !isHome(db, x.p)).sort((a, b) => (a.m.date < b.m.date ? -1 : a.m.date > b.m.date ? 1 : 0));
  const out = [];
  let cur = null;
  for (const { m, p } of away) {
    const brokenByHome = cur && homeDays.some((d) => d > cur.to && d < m.date);
    if (!cur || dayDiff(cur.to, m.date) > 2 || brokenByHome) {
      cur = { from: m.date, to: m.date, places: {} };
      out.push(cur);
    }
    cur.to = m.date;
    const pl = cur.places[p.key] || { key: p.key, name: p.name, country: p.country, countryName: p.countryName, total: 0 };
    pl.total -= m.amount;
    cur.places[p.key] = pl;
  }
  const saved = db.trips || [];
  const skipped = new Set(db.settings.tripsSkipped || []);
  return out
    .map((t) => ({ ...t, places: Object.values(t.places).sort((a, b) => b.total - a.total), id: `${t.from}|${t.to}|${Object.keys(t.places).sort().join(',')}` }))
    .filter((t) => !skipped.has(t.id) && !saved.some((s) => s.from <= t.to && s.to >= t.from))
    .reverse();
}

export const tripName = (t) => {
  const top = t.places[0];
  if (!top) return 'Viaje';
  return top.country !== 'ES' ? `Viaje a ${top.countryName}` : `Viaje a ${top.name}`;
};
