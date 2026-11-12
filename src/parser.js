// Lectores de PDF: extracto bancario (movimientos) y nómina.
// Funciones puras: reciben los textos ya extraídos del PDF como
// páginas de items { x, y, str } y devuelven datos estructurados.

const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const NUM = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{1,2}$/;

const pad = (n) => String(n).padStart(2, '0');

export function parseEsDate(s) {
  const m = String(s).trim().match(/(\d{1,2})\s+([a-zñ]+)\.?\s+(\d{4})/i);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
  return mo ? `${m[3]}-${pad(mo)}-${pad(+m[1])}` : null;
}

export function num(s) {
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
}

// Agrupa items en filas por su posición vertical.
export function toRows(items, tol = 3) {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

export function detectType(pages) {
  const text = pages.flat().map((i) => i.str).join(' ');
  if (/Movimientos de tu cuenta|F\. valor:/i.test(text)) return 'bank';
  if (/Total a percibir|Conceptos n[oó]mina|Total devengado/i.test(text)) return 'payslip';
  return null;
}

// Quita números de tarjeta y ruido, y saca un título legible.
export function describe(raw) {
  let d = raw
    .replace(/,?\s*Tarj(?:eta)?\.?\s*:?\s*\*?\d{4,}\s*,?/gi, '')
    .replace(/,?\s*Comision\s*[\d.,]*/gi, '')
    .replace(/\.?\s*Pan:\s*[\d.]+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s,.]+$/, '')
    .trim();
  let title = d;
  let note = '';
  let m;
  if ((m = d.match(/^Bizum De (.+?) Concepto:? ?(.*)$/i))) {
    title = m[1];
    note = 'Bizum recibido' + (m[2] && !/^Bizum De/i.test(m[2]) ? ' · ' + m[2] : '');
  } else if ((m = d.match(/^Bizum A Favor De (.+?) Concepto:? ?(.*)$/i))) {
    title = m[1];
    note = 'Bizum enviado' + (m[2] ? ' · ' + m[2] : '');
  } else if ((m = d.match(/^Compra Bizum (.+?)(?: \d{2}\/\d{2}\/\d{4})?$/i))) {
    title = m[1];
    note = 'Compra con Bizum';
  } else if ((m = d.match(/^(Pago Movil En|Compra Internet En|Compra En|Compra) (.+)$/i))) {
    const parts = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    title = parts[0];
    const place = (parts[1] || '').replace(/\s+Es$/i, '').replace(/\s*\(.*$/, '');
    const how = /Movil/i.test(m[1]) ? 'Pago móvil' : /Internet/i.test(m[1]) ? 'Compra por internet' : 'Compra con tarjeta';
    note = how + (place ? ' · ' + place : '');
  } else if ((m = d.match(/^Transferencia De (.+?),? ?Concepto:? ?(.*)$/i))) {
    title = m[1].replace(/ Empresa De Trabajo Temporal/i, '').replace(/ Tt S A/i, '');
    note = 'Transferencia' + (m[2] ? ' · ' + m[2].replace(/\.$/, '') : '');
  } else if (/^Ingreso En Cajero/i.test(d)) {
    title = 'Ingreso en cajero';
    note = 'Efectivo';
    d = 'Ingreso En Cajero Automatico';
  } else if ((m = d.match(/^Transferencia (?:A Favor De|A) (.+?)(?:,? ?Concepto:? ?(.*))?$/i))) {
    title = m[1];
    note = 'Transferencia enviada' + (m[2] ? ' · ' + m[2] : '');
  } else if ((m = d.match(/^Recibo (.+)$/i))) {
    title = m[1];
    note = 'Recibo domiciliado';
  }
  return { desc: d, title: title.trim(), note };
}

export function parseBank(pages) {
  const out = { holder: '', iban: '', balance: null, balanceDate: null, movements: [] };
  let ord = 0;
  for (const items of pages) {
    let cur = null;
    let curY = 0;
    for (const row of toRows(items)) {
      const first = row.items[0];
      const rest = row.items.slice(1).map((i) => i.str.trim()).join(' ').trim();
      const head = first.str.trim();
      if (/^Titular:/i.test(head)) { out.holder = rest; continue; }
      if (/^Cuenta:/i.test(head)) { out.iban = rest.replace(/\s+/g, ''); continue; }
      if (/^Saldo disponible/i.test(head)) {
        const n = row.items.find((i) => NUM.test(i.str.trim()));
        if (n) out.balance = num(n.str);
        out.balanceDate = parseEsDate(rest);
        continue;
      }
      const date = first.x < 60 ? parseEsDate(head) : null;
      if (date && !/^F\. valor/i.test(head)) {
        const nums = row.items.filter((i) => i.x >= 430 && NUM.test(i.str.trim())).map((i) => num(i.str));
        if (!nums.length) { cur = null; continue; }
        const raw = row.items.filter((i) => i.x >= 100 && i.x < 440 && !NUM.test(i.str.trim())).map((i) => i.str.trim()).join(' ');
        cur = { date, valueDate: date, raw, amount: nums[0], balance: nums.length > 1 ? nums[1] : null, ord: ord++ };
        curY = row.y;
        out.movements.push(cur);
        continue;
      }
      if (!cur || curY - row.y > 18) continue;
      const extra = row.items.filter((i) => i.x >= 100 && i.x < 440).map((i) => i.str.trim()).join(' ');
      if (/^F\. valor/i.test(head)) cur.valueDate = parseEsDate(head) || cur.valueDate;
      if (extra) cur.raw += ' ' + extra;
    }
  }
  for (const m of out.movements) {
    Object.assign(m, describe(m.raw));
    delete m.raw;
    m.id = `${m.date}|${m.amount.toFixed(2)}|${m.balance == null ? m.desc : m.balance.toFixed(2)}`;
  }
  return out;
}

// Nómina: lectura por etiquetas. Siempre se revisa en pantalla antes de guardar.
export function parsePayslip(pages) {
  const items = pages.flat();
  const text = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
  const isNum = (s) => /^-?\d[\d.]*(?:,\d+)?$/.test(s.trim());
  const below = (label) => {
    const l = items.find((i) => label.test(i.str));
    if (!l) return null;
    const c = items
      .filter((i) => isNum(i.str) && i.y < l.y + 2 && l.y - i.y < 40 && i.x > l.x - 15 && i.x < l.x + 130)
      .sort((a, b) => (l.y - a.y) - (l.y - b.y) || b.x - a.x);
    return c.length ? num(c[0].str) : null;
  };
  const iso = (d, m, y) => `${y}-${m}-${d}`;
  const p = { company: '', from: null, to: null, hours: null, earnings: [], gross: null, irpf: null, irpfPct: null, ss: null, totalDeductions: null, net: null };
  let m = text.match(/Desde\s+(\d{2})[-/](\d{2})[-/](\d{4})\s+Hasta\s+(\d{2})[-/](\d{2})[-/](\d{4})/i);
  if (m) { p.from = iso(m[1], m[2], m[3]); p.to = iso(m[4], m[5], m[6]); }
  else {
    const ds = [...text.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
    const i = text.search(/Periodo/i);
    const after = ds.filter((d) => d.index > i);
    if (after.length >= 2) { p.from = iso(after[0][1], after[0][2], after[0][3]); p.to = iso(after[1][1], after[1][2], after[1][3]); }
  }
  if (/ADECCO/i.test(text)) p.company = 'Adecco';
  let section = '';
  for (const row of toRows(items)) {
    const strs = row.items.map((i) => i.str.trim());
    const line = strs.join(' ');
    if (/Conceptos Salariales/i.test(line)) { section = 'earn'; continue; }
    if (/APORTACI[OÓ]N EMPRESARIAL/i.test(line)) { section = 'company'; continue; }
    if (/^\*?IRPF/i.test(line)) { section = 'irpf'; continue; }
    if (/Base remuneraci/i.test(line)) section = '';
    if (section !== 'earn' || !/^-/.test(line)) continue;
    const nums = strs.filter(isNum).map(num);
    const name = strs.filter((s) => !isNum(s) && s !== '-').join(' ').replace(/^-\s*/, '').trim();
    if (!name || !nums.length) continue;
    p.earnings.push({ name, qty: nums.length >= 3 ? nums[0] : null, price: nums.length >= 3 ? nums[1] : null, amount: nums[nums.length - 1] });
  }
  p.gross = below(/Total devengado/i);
  p.totalDeductions = below(/Total deducciones/i);
  p.net = below(/Total a percibir/i);
  p.irpf = below(/Retenci[oó]n IRPF/i);
  if (p.gross == null && p.earnings.length) p.gross = +p.earnings.reduce((a, e) => a + e.amount, 0).toFixed(2);
  if (p.totalDeductions == null && p.gross != null && p.net != null) p.totalDeductions = +(p.gross - p.net).toFixed(2);
  if (p.totalDeductions != null && p.irpf != null) p.ss = +(p.totalDeductions - p.irpf).toFixed(2);
  if (p.irpf != null && p.gross) p.irpfPct = +((p.irpf / p.gross) * 100).toFixed(2);
  const base = p.earnings.find((e) => /salario base/i.test(e.name));
  if (base && base.qty) p.hours = base.qty;
  return p;
}
