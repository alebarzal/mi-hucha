// Datos de la app: se guardan solo en el dispositivo (localStorage).

const KEY = 'mihucha.v1';

export const CATS = {
  nomina: { name: 'Nómina', icon: 'briefcase', color: '#1f9d6b', income: true },
  ingreso: { name: 'Otros ingresos', icon: 'plus-circle', color: '#3aa6a0', income: true },
  bizum_in: { name: 'Bizum recibido', icon: 'arrow-in', color: '#4f8fd9', income: true },
  super: { name: 'Supermercado', icon: 'cart', color: '#e0863a' },
  resta: { name: 'Bares y restaurantes', icon: 'utensils', color: '#d9577a' },
  gasolina: { name: 'Gasolina', icon: 'fuel', color: '#8a6fd1' },
  compras: { name: 'Compras', icon: 'bag', color: '#d1a13a' },
  salud: { name: 'Salud', icon: 'pill', color: '#3fae8c' },
  mascota: { name: 'Mascota', icon: 'paw', color: '#b07a4a' },
  ocio: { name: 'Ocio', icon: 'gamepad', color: '#5b7fe0' },
  hogar: { name: 'Casa y facturas', icon: 'home', color: '#7c8a99' },
  transporte: { name: 'Transporte', icon: 'bus', color: '#4aa3c7' },
  bizum_out: { name: 'Bizum enviado', icon: 'send', color: '#c76f5a' },
  ahorro: { name: 'Ahorro', icon: 'piggy', color: '#1f9d6b' },
  otros: { name: 'Otros', icon: 'box', color: '#8d8f96' },
};

const PET = /zooplus|tiendanimal|kiwoko|veterinari|protectora/i;
const RULES = [
  [PET, 'mascota'], // antes que Salud: «Clínica Veterinaria» no es una clínica para ti
  [/mercadona|leclerc|\bdia\b|carrefour|lidl|aldi|alcampo|market|gadis|froiz|eroski|consum|supermerc/i, 'super'],
  [/carbur|gasolin|repsol|cepsa|\bbp\b|galp|shell|petro/i, 'gasolina'],
  [/pizza|tapas|\bbar\b|restaur|cafe|casa vallejo|celi and co|martinica|burger|kebab|mcdonald|telepizza|glovo|just eat|cervec|meson|taberna/i, 'resta'],
  [/farmacia|dietet|clinica|dental|optica|fisio/i, 'salud'],
  [/amazon|tiktok|bazar|aliexpress|shein|zara|decathlon|ikea|primark|corte ingles|mediamarkt|obm/i, 'compras'],
  [/rotmg|steam|playstation|netflix|spotify|hbo|disney|twitch|cine|nintendo|xbox/i, 'ocio'],
  [/renfe|alsa|\bbus\b|taxi|uber|cabify|parking|peaje/i, 'transporte'],
  [/iberdrola|endesa|naturgy|movistar|vodafone|orange|digi|alquiler|comunidad|seguro|agua/i, 'hogar'],
];

// Palabras clave que el usuario añade desde Ajustes: { categoria: ['palabra', ...] }.
let KW = {};
export function setKeywords(k) { KW = k || {}; }
const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const kwMatch = (m, w) => plain((m.desc || '') + ' ' + (m.title || '')).includes(plain(w).trim());
function keywordCat(m) {
  for (const [cat, words] of Object.entries(KW)) if (CATS[cat] && words.some((w) => w && kwMatch(m, w))) return cat;
  return null;
}

export function guessCat(m, rules = {}) {
  const key = m.title.toLowerCase();
  if (rules[key]) return rules[key];
  const d = m.desc;
  if (m.amount > 0) {
    if (/n[oó]mina/i.test(d)) return m.amount >= 50 ? 'nomina' : 'ingreso';
    if (/^Bizum De/i.test(d)) return 'bizum_in';
    return 'ingreso';
  }
  if (/^Bizum A Favor/i.test(d)) return 'bizum_out';
  const kw = keywordCat(m);
  if (kw) return kw;
  for (const [re, cat] of RULES) if (re.test(d)) return cat;
  return 'otros';
}

const empty = () => ({ account: { holder: '', iban: '', balance: null, balanceDate: null }, movements: [], payslips: [], goals: [], trips: [], rules: {}, budgets: {}, catKeywords: {}, settings: { savePct: 20 } });

export let db = load();
setKeywords(db.catKeywords);

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return upgrade110(fixPending({ ...empty(), ...JSON.parse(raw) }));
  } catch { /* almacenamiento no disponible */ }
  return upgrade110(empty());
}

// Versión 1.10: categoría Mascota, su tope mensual y el objetivo del arenero (solo si ya había datos).
function upgrade110(d) {
  if (d.settings.v110) return d;
  d.settings.v110 = true;
  if (!d.movements.length && !d.payslips.length) return d;
  d.budgets = d.budgets || {};
  if (d.budgets.mascota == null) d.budgets.mascota = 35;
  d.settings.budgetMonthly = { ...(d.settings.budgetMonthly || {}), mascota: true };
  d.goals = d.goals || [];
  if (!d.goals.some((g) => /arenero/i.test(g.name))) d.goals.push({ id: 'g-arenero', name: 'Arenero automático', target: 225, icon: 'cat', saved: 0, due: '2027-04-13' });
  for (const m of d.movements) {
    if (m.amount < 0 && !m.catSet && !(d.rules || {})[m.title.toLowerCase()] && PET.test(m.desc || '')) m.cat = 'mascota';
  }
  return d;
}

// Avisos guardados por versiones anteriores con "con tu tarjeta" como comercio.
function fixPending(d) {
  for (const m of d.movements) {
    if (m.pending && /^(con tu tarjeta|tu tarjeta)/i.test(m.title)) {
      Object.assign(m, { title: 'Pago con tarjeta', note: 'Pago con tarjeta · pendiente de extracto', generic: true, score: 2 });
    }
  }
  return d;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* sin almacenamiento */ }
}

// Añade movimientos sin duplicar los que ya estaban (los extractos se solapan).
export function mergeBank(d, bank) {
  const seen = new Set(d.movements.map((m) => m.id));
  let added = 0;
  const stamp = Date.now();
  const fresh = [];
  for (const m of bank.movements) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    d.movements.push({ ...m, cat: guessCat(m, d.rules), ord: stamp * 1000 - m.ord });
    added++;
    fresh.push(m);
  }
  // El dato del extracto sustituye al aviso provisional del banco.
  for (const m of fresh) {
    const i = d.movements.findIndex((p) => p.pending && Math.abs(p.amount - m.amount) < 0.005 && Math.abs(dayDiff(p.date, m.date)) <= 4);
    if (i >= 0) d.movements.splice(i, 1);
  }
  sortMovs(d);
  if (bank.balanceDate && (!d.settings.lastImport || bank.balanceDate > d.settings.lastImport)) d.settings.lastImport = bank.balanceDate;
  if (bank.balance != null && (!d.account.balanceDate || (bank.balanceDate || '') >= d.account.balanceDate)) {
    d.account = { holder: bank.holder, iban: bank.iban, balance: bank.balance, balanceDate: bank.balanceDate };
  }
  return added;
}

function sortMovs(d) {
  d.movements.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.ord - a.ord));
}

// Apunte a mano (efectivo u otros gastos que no salen en el extracto).
export function addManual({ date, title, amount, cat }) {
  db.movements.push({ id: 'm-' + Date.now().toString(36), date, valueDate: date, desc: title, title, note: 'Apunte a mano', amount, balance: null, cat, ord: Date.now() * 1000, manual: true });
  sortMovs(db);
}

// Cambia un apunte a mano o un aviso pendiente.
export function editMov(id, { date, title, amount, cat }) {
  const m = db.movements.find((x) => x.id === id);
  if (!m) return;
  Object.assign(m, { date, valueDate: date, title, amount, cat, catSet: true });
  if (m.manual) m.desc = title;
  sortMovs(db);
}

// Movimiento provisional creado a partir de un aviso del banco.
export function addPending(m) {
  const dup = db.movements.find((x) => x.id === m.id || (x.pending && Math.abs(x.amount - m.amount) < 0.005 && Math.abs(x.time - m.time) < 180000));
  if (dup) {
    if (m.geo && !dup.geo) dup.geo = m.geo;
    // El banco manda a veces dos avisos del mismo movimiento: nos quedamos con el más detallado.
    if (dup.id === m.id || (m.score ?? 0) <= (dup.score ?? (dup.generic ? 0 : 4))) return false;
    Object.assign(dup, { title: m.title, desc: m.desc, note: m.note, raw: m.raw, generic: m.generic, score: m.score, geo: dup.geo || m.geo, cat: dup.catSet ? dup.cat : guessCat(m, db.rules) });
    return 'merged';
  }
  db.movements.push({ ...m, cat: guessCat(m, db.rules), ord: m.time * 1000 });
  sortMovs(db);
  return 'added';
}

export function replaceDb(next) { db = upgrade110({ ...empty(), ...next }); setKeywords(db.catKeywords); save(); }
export function resetDb() { db = empty(); save(); }

// ---------- cálculos ----------
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function toDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function dayDiff(a, b) { return Math.round((toDate(b) - toDate(a)) / 864e5); }

export const paydays = () => db.movements.filter((m) => m.cat === 'nomina').sort((a, b) => (a.date < b.date ? -1 : 1));

// Periodos de nómina a nómina (el más reciente primero).
export function periods() {
  const pays = paydays();
  const list = [];
  if (!db.movements.length) return list;
  const firstDate = db.movements[db.movements.length - 1].date;
  if (!pays.length) list.push({ from: firstDate, to: null, pay: null });
  else {
    if (firstDate < pays[0].date) list.push({ from: firstDate, to: pays[0].date, pay: null });
    pays.forEach((p, i) => list.push({ from: p.date, to: pays[i + 1]?.date || null, pay: p }));
  }
  for (const p of list) {
    p.movs = db.movements.filter((m) => m.date >= p.from && (!p.to || m.date < p.to));
    p.income = p.movs.filter((m) => m.amount > 0).reduce((a, m) => a + m.amount, 0);
    p.spent = -p.movs.filter((m) => m.amount < 0 && m.cat !== 'ahorro').reduce((a, m) => a + m.amount, 0);
    p.saved = p.income - p.spent;
    p.byCat = {};
    for (const m of p.movs) if (m.amount < 0) p.byCat[m.cat] = (p.byCat[m.cat] || 0) - m.amount;
  }
  return list.reverse();
}

// Fecha estimada de la próxima nómina según los días de cobro anteriores.
export function nextPayday() {
  const pays = paydays();
  if (!pays.length) return null;
  const day = Math.round(pays.reduce((a, p) => a + toDate(p.date).getDate(), 0) / pays.length);
  const last = toDate(pays[pays.length - 1].date);
  const n = new Date(last.getFullYear(), last.getMonth() + 1, day);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

// Gasto de una categoría en un mes natural (AAAA-MM).
export function monthSpent(cat, ym = todayIso().slice(0, 7)) {
  return -db.movements.filter((m) => m.amount < 0 && m.cat === cat && m.date.startsWith(ym)).reduce((a, m) => a + m.amount, 0);
}

// Estado de un tope: por mes natural o desde la última nómina.
export function budgetUse(k) {
  const b = db.budgets[k];
  if (!b) return null;
  const monthly = !!db.settings.budgetMonthly?.[k];
  let spent = 0, key = '';
  if (monthly) { key = todayIso().slice(0, 7); spent = monthSpent(k, key); }
  else { const p = periods()[0]; if (p) { key = p.from; spent = p.byCat[k] || 0; } }
  return { b, monthly, spent, key, r: spent / b };
}

export const goalsTotal = () => db.goals.reduce((a, g) => a + g.saved, 0);
