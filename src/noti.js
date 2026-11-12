// Convierte el texto de un aviso del banco en un movimiento provisional.
// Devuelve { skip: motivo } si el aviso no describe un cobro o un pago.
//
// Formatos reales del Santander (nov 2026):
//   "¡Tu saldo ha cambiado!"  ·  "Ha habido un movimiento de -0.5 EUR en tu cuenta **1234. Pulsa aquí para ver el detalle"
//   "¡BIZUM recibido!"        ·  "Nombre Apellido A. B. te ha enviado un BIZUM de 0.50 EUR por h. Pulsa para +info"

const AMOUNT = /(-\s?)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(?:€|eur\b|euros?\b)/i;
const SECRET = /clave|c[oó]digo|firma|\botp\b|caduca|verifica|autoriza(?:r|ci[oó]n)|no compartas/i;
const NOT_MONEY_MOVE = /saldo disponible|l[ií]mite|oferta|pr[eé]stamo|preconcedid|sorteo|descuento|hasta \d|desde \d|consigue|gana /i;
const INCOME = /has recibido|recibid[oa]|te ha enviado|te han enviado|ingreso|abono|n[oó]mina|devoluci[oó]n|reembolso|transferencia a tu favor/i;
const EXPENSE = /compra|pago|pagado|cargo|has enviado|enviado a|retirada|reintegro|recibo|adeudo|transferencia emitida/i;
const GENERIC = /movimiento de/i;

const pad = (n) => String(n).padStart(2, '0');
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s:,¡!-]+|[\s:,!-]+$/g, '').trim();
const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : s);
// Quita emojis y símbolos decorativos del principio.
const clean = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();

export function parseNoti({ title = '', text = '', time, pkg = '' }) {
  title = clean(title);
  text = clean(text);
  const all = tidy(`${title}. ${text}`);
  if (!all) return { skip: 'vacío' };
  if (SECRET.test(all)) return { skip: 'clave o código' };
  if (NOT_MONEY_MOVE.test(all)) return { skip: 'publicidad o saldo' };
  const m = all.match(AMOUNT);
  if (!m) return { skip: 'sin importe' };
  let raw = m[2];
  raw = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
  const value = parseFloat(raw);
  if (!isFinite(value) || value <= 0 || value > 100000) return { skip: 'importe no válido' };

  const negative = !!m[1];
  const generic = GENERIC.test(all) && !/bizum/i.test(all);
  const wallet = /wallet|spay/i.test(pkg);
  let income;
  if (negative) income = false;
  else if (generic) income = true;
  else income = INCOME.test(all) && !/has enviado|enviado a/i.test(all);
  if (!income && !negative && !generic && !wallet && !EXPENSE.test(all)) return { skip: 'no parece un cobro ni un pago' };

  const bizum = /bizum/i.test(all);
  let who = '';
  let concept = '';
  let k;
  if ((k = text.match(/^(.{2,60}?)\s+te ha(?:n)? enviado/i))) who = k[1];
  else if (generic) who = '';
  else if ((k = all.match(/\ben\s+(?!tu\b|su\b|el\b|la\b|cuenta\b|con\b|por\b)([^.,;:()]{2,40}?)(?=\s+(?:con|por|el|a las|de \d|del \d)\b|[.,;:()]|$)/i))) who = k[1];
  else if (income && (k = all.match(/\bde\s+(?!\d)([A-ZÁÉÍÓÚÑ][^.,;:()\d]{2,40}?)(?=\s+(?:por|con|concepto)\b|[.,;:()]|$)/))) who = k[1];
  else if (!income && (k = all.match(/\b(?:enviado a|a favor de|para|a)\s+([A-ZÁÉÍÓÚÑ][^.,;:()\d]{2,40}?)(?=\s+(?:por|con|concepto)\b|[.,;:()]|$)/))) who = k[1];
  if (/retirada|reintegro|cajero/i.test(all)) who = 'Retirada en cajero';
  else if (wallet) {
    const generic = /^(pago|compra|tarjeta|wallet|google|samsung|transacci|has |¡)/i;
    const pre = tidy(text.split(AMOUNT)[0]).replace(/[·\-–:|]+$/, '').trim();
    const cand = title && !AMOUNT.test(title) && !generic.test(title) ? title : pre;
    if (cand && cand.length > 2 && !AMOUNT.test(cand) && !generic.test(cand)) who = cand;
  }
  who = who.replace(/\s+/g, ' ').trim();
  if (/^(con|tu|su)\b|tarjeta|\*\*\d/i.test(who)) who = '';
  who = titleCase(who);
  const card = /tarjeta/i.test(all) && !income;
  if (bizum && (k = text.match(/(?:eur|€|euros?)\s+por\s+(.+?)(?:\.\s|\.$|$)/i))) concept = k[1].trim();

  const stamp = time || Date.now();
  const d = new Date(stamp);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const kind = bizum ? (income ? 'Bizum recibido' : 'Bizum enviado') : card ? 'Pago con tarjeta' : 'Aviso del banco';
  return {
    id: `n-${stamp}-${Math.round(value * 100)}`,
    date, valueDate: date,
    title: who || (bizum ? 'Bizum' : card ? 'Pago con tarjeta' : income ? 'Ingreso' : 'Pago'),
    desc: bizum ? (income ? `Bizum De ${who}` : `Bizum A Favor De ${who}`) : all,
    raw: all.slice(0, 200),
    note: `${kind}${concept ? ' · ' + concept : ''} · pendiente de extracto`,
    amount: income ? value : -value,
    balance: null,
    pending: true,
    generic: generic || !who,
    // Cuánta información trae el aviso: de dos avisos del mismo pago se queda el de mayor puntuación.
    score: (who ? 4 : 0) + (bizum || card ? 2 : 0) + (concept ? 1 : 0),
    time: stamp,
  };
}
