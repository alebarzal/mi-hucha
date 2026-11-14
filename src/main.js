import { Capacitor, registerPlugin } from '@capacitor/core';
import { CATS, db, save, mergeBank, addManual, editMov, addPending, budgetUse, setKeywords, kwMatch, replaceDb, resetDb, periods, paydays, nextPayday, goalsTotal, todayIso, toDate, dayDiff } from './store.js';
import { detectType, parseBank, parsePayslip } from './parser.js';
import { forecast, LIMIT_ONE_PAYER, LIMIT_TWO_PAYERS, SECOND_PAYER_MIN } from './tax.js';
import { parseNoti } from './noti.js';
import { CHANGELOG } from './changelog.js';
import { TAB_DEFS, HOME_DEFS, tabLayout, homeLayout, enableDrag } from './layout.js';
import { placeOf, placeStats, suggestHome, detectTrips, tripSummary, tripName, norm } from './trips.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const sheet = $('#sheet');
const state = { tab: 'home', period: 0, filter: 'all', query: '', draft: null };

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const eur0Fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
const eur = (n) => eurFmt.format(n || 0);
const eur0 = (n) => eur0Fmt.format(n || 0);
const signed = (n) => (n > 0 ? '+' : '') + eur(n);
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const short = (iso) => { const d = toDate(iso); return `${d.getDate()} ${MES[d.getMonth()]}`; };
const long = (iso) => { const s = toDate(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); return s[0].toUpperCase() + s.slice(1); };
const prevDay = (iso) => { const d = toDate(iso); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const parseNum = (v) => { const n = parseFloat(String(v).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const periodLabel = (p) => (!p.pay ? (p.to ? `Antes del ${short(p.to)}` : 'Todo') : p.to ? `${short(p.from)} – ${short(prevDay(p.to))}` : `Desde el ${short(p.from)}`);
const slipFor = (m) => db.payslips.find((p) => Math.abs(p.net - m.amount) < 0.01);
const slipMonth = (p) => { const d = toDate(p.from); return `${MES_L[d.getMonth()]} ${d.getFullYear()}`; };

let toastTimer, undoFn = null;
function toast(msg, undo) {
  const t = $('#toast');
  t.textContent = msg;
  undoFn = undo || null;
  if (undo) t.insertAdjacentHTML('beforeend', ' <button data-act="undo">Deshacer</button>');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; undoFn = null; }, undo ? 6000 : 3200);
}
// Hace un cambio que se puede deshacer desde el aviso durante unos segundos.
function withUndo(msg, change) {
  const snap = JSON.stringify(db);
  change();
  save(); render();
  toast(msg, () => { replaceDb(JSON.parse(snap)); render(); toast('Deshecho.'); });
}
const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const daysAgo = (iso) => { const n = dayDiff(iso, todayIso()); return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`; };

// ---------- hoja inferior ----------
function openSheet(html) {
  const wasOpen = !sheet.hidden;
  sheet.innerHTML = `<div class="backdrop" data-act="close"></div><div class="panel" role="dialog"><div class="grab"></div>${html}</div>`;
  sheet.hidden = false;
  document.body.classList.add('locked');
  if (!wasOpen) history.pushState({ sheet: 1 }, '');
}
function closeSheet(fromPop) {
  if (sheet.hidden) return;
  sheet.hidden = true;
  sheet.innerHTML = '';
  document.body.classList.remove('locked');
  if (!fromPop) { skipPop++; history.back(); }
  if (updPending) setTimeout(updatePopup, 350);
}
let skipPop = 0;
window.addEventListener('popstate', () => { if (skipPop) skipPop--; else closeSheet(true); });

// ---------- piezas ----------
const ICONS = {
  spending: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.500A9 9 0 0 1 20.500 9H15z"/>',
  trips: '<rect x="3" y="7" width="18" height="13" rx="2.500"/><path d="M8.500 7V5.500A2 2 0 0 1 10.500 3.500h3a2 2 0 0 1 2 2V7M3 13h18"/>',
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  movs: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  payroll: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  savings: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c-.6-1-1.700-1.500-3-1.500-1.700 0-3 .900-3 2s1.300 2 3 2 3 .900 3 2-1.300 2-3 2c-1.300 0-2.400-.500-3-1.500"/>',
};
ICONS.more = '<circle cx="5.500" cy="12" r="1.600"/><circle cx="12" cy="12" r="1.600"/><circle cx="18.500" cy="12" r="1.600"/>';
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.500"/><circle cx="15" cy="6" r="1.500"/><circle cx="9" cy="12" r="1.500"/><circle cx="15" cy="12" r="1.500"/><circle cx="9" cy="18" r="1.500"/><circle cx="15" cy="18" r="1.500"/></svg>';
// Botones de la barra inferior según el orden elegido; lo oculto va a «Más».
function tabButtons(active, layout = tabLayout(db.settings)) {
  const shown = layout.filter((t) => t.on);
  const hidden = layout.filter((t) => !t.on);
  const btn = (k, label, act = 'tab') => `<button class="${active === k || (k === 'more' && hidden.some((t) => t.k === active)) ? 'on' : ''}" data-act="${act}" data-tab="${k}"><svg viewBox="0 0 24 24">${ICONS[k]}</svg><span>${label}</span></button>`;
  return shown.map((t) => btn(t.k, TAB_DEFS[t.k])).join('') + (hidden.length ? btn('more', 'Más', 'more') : '');
}

function movRow(m) {
  const c = CATS[m.cat] || CATS.otros;
  return `<button class="row" data-act="mov" data-id="${esc(m.id)}">
    <span class="bubble" style="--c:${c.color}">${c.icon}</span>
    <span class="row-main"><b>${esc(m.title)}</b><small>${m.pending && m.geo?.locality ? '📍 ' + esc(m.geo.locality) + ' · ' : ''}${esc(m.note || c.name)}</small></span>
    <span class="amt ${m.amount > 0 ? 'pos' : ''}">${signed(m.amount)}</span>
  </button>`;
}

const emptyState = (title, text) => `<div class="empty"><div class="empty-ico">📄</div><b>${title}</b><p>${text}</p><button class="btn" data-act="import">Importar PDF</button></div>`;

// ---------- Inicio ----------
function home() {
  const per = periods();
  const name = (db.account.holder || '').trim().split(/\s+/).pop() || '';
  const head = `<header class="top"><div><p class="hi">${name ? 'Hola, ' + esc(name) : 'Bienvenido'}</p><h1>Mi Hucha</h1></div>
    <div class="top-btns"><button class="icon-btn" data-act="hide-money" aria-label="${db.settings.hideMoney ? 'Mostrar importes' : 'Ocultar importes'}"><svg viewBox="0 0 24 24"><path d="M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>${db.settings.hideMoney ? '<path d="M4 4l16 16"/>' : ''}</svg></button>
    <button class="icon-btn" data-act="settings" aria-label="Ajustes"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.400 15a1.700 1.700 0 0 0 .300 1.800l.100.100a2 2 0 1 1-2.800 2.800l-.100-.100a1.700 1.700 0 0 0-2.800 1.200V21a2 2 0 1 1-4 0v-.100a1.700 1.700 0 0 0-2.900-1.200l-.100.100a2 2 0 1 1-2.800-2.800l.100-.100A1.700 1.700 0 0 0 3 14H3a2 2 0 1 1 0-4h.100a1.700 1.700 0 0 0 1.200-2.900l-.100-.100a2 2 0 1 1 2.800-2.800l.100.100A1.700 1.700 0 0 0 10 3V3a2 2 0 1 1 4 0v.100a1.700 1.700 0 0 0 2.900 1.200l.100-.100a2 2 0 1 1 2.800 2.800l-.100.100A1.700 1.700 0 0 0 21 10h0a2 2 0 1 1 0 4h-.100a1.700 1.700 0 0 0-1.500 1z"/></svg></button></div></header>`;
  if (!db.movements.length) return head + emptyState('Empieza importando un PDF', 'Sube el extracto de tu banco o una nómina y la app lo ordena todo por ti.');

  const hero = `<section class="hero">
    <p>Saldo disponible</p>
    <div class="big">${eur(balanceInfo().value)}</div>
    <small>${heroSub()}${db.account.iban ? ' · cuenta ····' + esc(db.account.iban.slice(-4)) : ''}</small>
    <button class="btn light" data-act="import">＋ Importar PDF</button>
  </section>`;

  let now = '';
  const cur = per[0];
  if (cur && cur.pay && !cur.to) {
    const left = cur.income - cur.spent;
    const pct = Math.min(100, Math.round((cur.spent / (cur.income || 1)) * 100));
    const next = nextPayday();
    const days = next ? dayDiff(todayIso(), next) : null;
    const target = (cur.pay.amount * db.settings.savePct) / 100;
    const free = cur.income - target - cur.spent;
    let tip = '';
    if (days != null && days > 0) {
      tip = free > 0
        ? `Para ahorrar el ${db.settings.savePct} % de la nómina (${eur0(target)}) puedes gastar unos <b>${eur0(free / days)} al día</b> hasta la próxima.`
        : `Ya has gastado más de lo previsto para ahorrar el ${db.settings.savePct} % (${eur0(target)}).`;
    }
    now = `<section class="card">
      <div class="card-head"><h2>Desde tu última nómina</h2><span class="tag">${short(cur.from)}</span></div>
      <div class="stats">
        <div><small>Cobrado</small><b class="pos">${eur(cur.income)}</b></div>
        <div><small>Gastado</small><b>${eur(cur.spent)}</b></div>
        <div><small>Te queda</small><b>${eur(left)}</b></div>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <p class="hint">Has gastado el ${pct} % de lo cobrado.${days != null ? (days > 0 ? ` Próxima nómina hacia el <b>${short(next)}</b>, faltan ${days} días.` : ' La próxima nómina debería llegar estos días.') : ''}</p>
      ${tip ? `<p class="tip">💡 ${tip}</p>` : ''}
    </section>`;
  }

  const idx = Math.min(state.period, per.length - 1);
  const p = per[idx];
  const budKeys = Object.keys(db.budgets).filter((k) => db.budgets[k] > 0);
  const cats = [...new Set([...Object.keys(p.byCat), ...budKeys])].map((k) => [k, p.byCat[k] || 0]).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] || 1 : 1;
  const chips = per.map((x, i) => `<button class="chip ${i === idx ? 'on' : ''}" data-act="period" data-i="${i}">${periodLabel(x)}</button>`).join('');
  const spend = `<section class="card">
    <div class="card-head"><h2>En qué se va el dinero</h2><span class="tag">${eur(p.spent)}</span></div>
    <div class="chips">${chips}</div>
    ${cats.length ? cats.map(([k, v]) => {
      const c = CATS[k] || CATS.otros;
      return `<button class="cat" data-act="cat-filter" data-cat="${k}">
        <span class="bubble" style="--c:${c.color}">${c.icon}</span>
        <span class="cat-main"><span class="cat-top"><b>${c.name}</b><span>${eur(v)}${db.budgets[k] ? ` <small>${budgetUse(k).monthly ? '· ' + budTxt(k) : 'de ' + eur0(db.budgets[k])}</small>` : ''}</span></span>
        <span class="bar thin"><i style="${barStyle(k, v, max, c.color)}"></i></span></span>
      </button>`;
    }).join('') : '<p class="hint">Sin gastos en este periodo.</p>'}
    <button class="btn ghost wide" data-act="budgets">${budKeys.length ? 'Cambiar topes de gasto' : 'Poner topes de gasto'}</button>
  </section>`;

  const last = `<section class="card flush">
    <div class="card-head pad"><h2>Últimos movimientos</h2><button class="link" data-act="tab" data-tab="movs">Ver todos</button></div>
    ${db.movements.slice(0, 5).map(movRow).join('')}
  </section>`;
  const remind = db.settings.remind === undefined ? `<section class="card"><div class="card-head"><h2>🔔 ¿Te aviso cuando toque?</h2></div>
    <p class="hint">Un recordatorio si llevas 15 días sin importar el extracto y otro al día siguiente de cobrar.</p>
    <div class="actions"><button class="btn" data-act="remind" data-on="1">Activar avisos</button><button class="btn ghost" data-act="remind" data-on="0">No, gracias</button></div></section>` : '';
  const askHome = !db.settings.home?.length && placeStats(db).length ? askHomeCard() : '';
  const alerts = Object.keys(db.budgets).map((k) => [k, budgetUse(k)]).filter(([, u]) => u && u.r >= 0.8).map(([k, u]) => {
    const c = CATS[k] || CATS.otros;
    return `<button class="note budget-alert ${u.r >= 1 ? 'over' : ''}" data-act="cat-filter" data-cat="${k}"><b>${c.icon} ${u.r >= 1 ? 'Te has pasado del tope de' : 'Cerca del tope de'} ${c.name}</b>
      <span>${eur(u.spent)} de ${eur0(u.b)} ${u.monthly ? 'este mes' : 'desde la última nómina'} · ${Math.round(u.r * 100)} %</span></button>`;
  }).join('');
  const upd = db.settings.updAvail && db.settings.updAvail !== __BUILD_SHA__ ? `<section class="card"><div class="card-head"><h2>⬆️ Hay una versión nueva</h2>${updInfo().v ? `<span class="tag">${esc(updInfo().v)}</span>` : ''}</div>
    <p class="hint">${updInfo().text ? esc(updInfo().text.charAt(0).toUpperCase() + updInfo().text.slice(1)) + '. ' : ''}Se instala encima y tus datos se mantienen.</p>
    <div class="actions"><button class="btn" data-act="update">Actualizar ahora</button></div></section>` : '';
  const lb = db.settings.lastBackup;
  const snoozed = db.settings.backupSnooze && dayDiff(db.settings.backupSnooze, todayIso()) < 14;
  const backup = db.movements.length >= 20 && !snoozed && (!lb || dayDiff(lb, todayIso()) > 30) ? `<section class="card"><div class="card-head"><h2>💾 ${lb ? 'Toca hacer una copia' : 'Aún no tienes copia de seguridad'}</h2></div>
    <p class="hint">${lb ? `La última es de ${daysAgo(lb)}.` : 'Tus datos solo están en este móvil.'} Guárdala en Drive o envíatela por correo para no perder nada.</p>
    <div class="actions"><button class="btn" data-act="export">Hacer copia</button><button class="btn ghost" data-act="backup-later">Más tarde</button></div></section>` : '';
  const goalsCard = db.goals.length ? `<section class="card"><div class="card-head"><h2>Tus objetivos</h2><button class="link" data-act="tab" data-tab="savings">Ver todos</button></div>
    ${db.goals.slice(0, 3).map((g) => { const pct = Math.min(100, Math.round((g.saved / g.target) * 100)); return `<button class="mini-goal" data-act="goal" data-id="${g.id}"><span class="cat-top"><b>${g.emoji} ${esc(g.name)}</b><span>${eur0(g.saved)} <small>de ${eur0(g.target)}</small></span></span><span class="bar thin"><i style="width:${pct}%"></i></span></button>`; }).join('')}</section>`
    : `<section class="card"><div class="card-head"><h2>Tus objetivos</h2></div><p class="hint">Aún no tienes objetivos de ahorro.</p><button class="btn ghost wide" data-act="goal-new">＋ Crear objetivo</button></section>`;
  const parts = { now, spend, last, goals: goalsCard };
  const body = homeLayout(db.settings).filter((c) => c.on).map((c) => parts[c.k]).join('');
  return head + hero + upd + remind + askHome + alerts + body + backup;
}

// ---------- Movimientos ----------
function movList() {
  const q = plain(state.query.trim());
  const f = state.filter;
  const list = db.movements.filter((m) => {
    if (f === 'in' && m.amount <= 0) return false;
    if (f === 'out' && m.amount >= 0) return false;
    if (!['all', 'in', 'out'].includes(f) && m.cat !== f) return false;
    return !q || plain(m.title + ' ' + m.note + ' ' + m.desc + ' ' + (m.geo?.locality || '')).includes(q) || Math.abs(m.amount).toFixed(2).replace('.', ',').includes(q.replace('.', ','));
  });
  if (!list.length) return '<p class="hint center">No hay movimientos que coincidan.</p>';
  const total = list.reduce((a, m) => a + m.amount, 0);
  let html = `<p class="hint center">${list.length} ${list.length === 1 ? "movimiento" : "movimientos"} · ${signed(total)}</p>`;
  let day = '';
  for (const m of list) {
    if (m.date !== day) {
      if (day) html += '</section>';
      day = m.date;
      html += `<h3 class="day">${long(day)}</h3><section class="card flush">`;
    }
    html += movRow(m);
  }
  return html + '</section>';
}

function movs() {
  if (!db.movements.length) return `<header class="top"><h1>Movimientos</h1></header>` + emptyState('Aún no hay movimientos', 'Importa el extracto en PDF de tu banco para verlos aquí.');
  const used = [...new Set(db.movements.map((m) => m.cat))];
  const chip = (k, label) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${label}</button>`;
  return `<header class="top"><h1>Movimientos</h1><button class="btn small" data-act="import">＋ PDF</button></header>
    <input class="search" id="q" type="search" placeholder="Buscar comercio, persona, importe…" value="${esc(state.query)}" />
    <div class="chips scroll">${chip('all', 'Todos')}${chip('in', 'Ingresos')}${chip('out', 'Gastos')}${used.map((k) => chip(k, `${CATS[k].icon} ${CATS[k].name}`)).join('')}</div>
    <div id="mov-list">${movList()}</div>`;
}

// ---------- Nóminas ----------
function payroll() {
  const pays = paydays().reverse();
  const head = `<header class="top"><h1>Nóminas</h1><button class="btn small" data-act="import">＋ PDF</button></header>`;
  if (!pays.length && !db.payslips.length) return head + emptyState('Sin nóminas todavía', 'Importa una nómina en PDF o el extracto del banco: los ingresos de nómina se detectan solos.');
  const total = pays.reduce((a, m) => a + m.amount, 0);
  const avg = pays.length ? total / pays.length : 0;
  const withHours = db.payslips.filter((p) => p.hours > 0);
  const perHour = withHours.length ? withHours.reduce((a, p) => a + p.net, 0) / withHours.reduce((a, p) => a + p.hours, 0) : null;
  const tiles = `<div class="tiles">
    <div class="tile"><small>Cobrado en total</small><b>${eur(total)}</b></div>
    <div class="tile"><small>Media neta</small><b>${eur(avg)}</b></div>
    <div class="tile"><small>Neto por hora</small><b>${perHour ? eur(perHour) : '—'}</b></div>
  </div>`;
  const warn = taxCard();

  const cards = pays.map((m) => {
    const s = slipFor(m);
    return `<button class="pay" data-act="${s ? 'slip' : 'slip-missing'}" data-id="${esc(s ? s.id : m.id)}">
      <span class="pay-top"><span><small>Cobrada el ${short(m.date)}</small><b>${eur(m.amount)}</b></span><span class="bubble" style="--c:${CATS.nomina.color}">💼</span></span>
      ${s ? `<span class="pay-sub">Nómina de ${slipMonth(s)}${s.hours ? ' · ' + s.hours + ' h' : ''} · bruto ${eur(s.gross)}</span>
        <span class="split"><i class="net" style="flex:${s.net}"></i><i class="ss" style="flex:${s.ss || 0}"></i><i class="irpf" style="flex:${s.irpf || 0}"></i></span>`
      : `<span class="pay-sub muted">Sin desglose. Toca para añadir la nómina.</span>`}
    </button>`;
  }).join('');
  const orphans = db.payslips.filter((s) => !pays.some((m) => Math.abs(s.net - m.amount) < 0.01)).map((s) => `<button class="pay" data-act="slip" data-id="${esc(s.id)}">
      <span class="pay-top"><span><small>Nómina de ${slipMonth(s)}</small><b>${eur(s.net)}</b></span><span class="bubble" style="--c:${CATS.nomina.color}">💼</span></span>
      <span class="pay-sub muted">Aún no aparece el ingreso en el banco.</span></button>`).join('');
  return head + tiles + warn + `<h3 class="day">Tus nóminas</h3>` + orphans + cards +
    `<div class="actions"><button class="btn" data-act="import">Importar nómina PDF</button><button class="btn ghost" data-act="slip-new">Añadir a mano</button></div>`;
}

function slipSheet(s) {
  const line = (l, v, cls = '') => `<div class="line ${cls}"><span>${esc(l)}</span><b>${v}</b></div>`;
  openSheet(`<h2>Nómina de ${slipMonth(s)}</h2>
    <p class="hint">${esc(s.company || '')}${s.role ? ' · ' + esc(s.role) : ''} · del ${short(s.from)} al ${short(s.to)}</p>
    <div class="big center">${eur(s.net)}</div><p class="hint center">neto, de ${eur(s.gross)} brutos</p>
    <div class="split tall"><i class="net" style="flex:${s.net}"></i><i class="ss" style="flex:${s.ss || 0}"></i><i class="irpf" style="flex:${s.irpf || 0}"></i></div>
    <div class="legend"><span><i class="net"></i>Neto ${Math.round((s.net / s.gross) * 100)} %</span><span><i class="ss"></i>Seg. Social ${eur(s.ss)}</span><span><i class="irpf"></i>IRPF ${eur(s.irpf)}</span></div>
    ${s.hours ? `<div class="tiles two"><div class="tile"><small>Bruto por hora</small><b>${eur(s.gross / s.hours)}</b></div><div class="tile"><small>Neto por hora</small><b>${eur(s.net / s.hours)}</b></div></div>` : ''}
    ${s.earnings?.length ? `<h3>Lo que te pagan</h3>${s.earnings.map((e) => line(e.name + (e.qty ? ` · ${e.qty} × ${String(e.price).replace('.', ',')}` : ''), eur(e.amount))).join('')}${line('Total devengado', eur(s.gross), 'sum')}` : ''}
    <h3>Lo que te descuentan</h3>
    ${s.deductions?.length ? s.deductions.map((d) => line(d.name, '−' + eur(d.amount))).join('') : line('Seguridad Social', '−' + eur(s.ss)) + line(`IRPF${s.irpfPct != null ? ' (' + String(s.irpfPct).replace('.', ',') + ' %)' : ''}`, '−' + eur(s.irpf))}
    ${line('Total deducciones', '−' + eur(s.totalDeductions), 'sum')}
    <div class="actions"><button class="btn ghost" data-act="slip-edit" data-id="${esc(s.id)}">Editar</button><button class="btn danger" data-act="slip-del" data-id="${esc(s.id)}">Eliminar</button></div>`);
}

function slipForm(d, title = 'Revisa la nómina') {
  state.draft = d;
  const f = (id, label, val, type = 'text', mode = 'decimal') => `<label class="field"><span>${label}</span><input id="f-${id}" type="${type}" ${type === 'text' ? `inputmode="${mode}"` : ''} value="${esc(val ?? '')}" /></label>`;
  const n = (v) => (v == null ? '' : String(v).replace('.', ','));
  openSheet(`<h2>${title}</h2><p class="hint">Comprueba que los datos coinciden con tu nómina antes de guardar.</p>
    ${f('company', 'Empresa', d.company, 'text', 'text')}
    <div class="grid2">${f('from', 'Desde', d.from, 'date')}${f('to', 'Hasta', d.to, 'date')}</div>
    <div class="grid2">${f('gross', 'Bruto (total devengado)', n(d.gross))}${f('hours', 'Horas trabajadas', n(d.hours))}</div>
    <div class="grid2">${f('ss', 'Seguridad Social', n(d.ss))}${f('irpf', 'IRPF', n(d.irpf))}</div>
    ${f('net', 'Neto (total a percibir)', n(d.net))}
    <div class="actions"><button class="btn" data-act="slip-save">Guardar nómina</button></div>`);
}

function saveSlip() {
  const v = (id) => $('#f-' + id).value;
  const d = state.draft || {};
  const gross = parseNum(v('gross')), net = parseNum(v('net'));
  if (!v('from') || !v('to') || gross == null || net == null) return toast('Faltan las fechas, el bruto o el neto.');
  const ss = parseNum(v('ss')) ?? 0, irpf = parseNum(v('irpf')) ?? 0;
  const changed = d.ss !== ss || d.irpf !== irpf;
  const s = { ...d, id: d.id || 'p-' + uid(), company: v('company').trim(), from: v('from'), to: v('to'), hours: parseNum(v('hours')), gross, net, ss, irpf,
    irpfPct: gross ? +((irpf / gross) * 100).toFixed(2) : null, totalDeductions: +(gross - net).toFixed(2), deductions: changed ? [] : d.deductions || [] };
  const i = db.payslips.findIndex((p) => p.id === s.id);
  if (i >= 0) db.payslips[i] = s; else db.payslips.push(s);
  db.payslips.sort((a, b) => (a.from < b.from ? 1 : -1));
  save(); closeSheet(); state.tab = 'payroll'; render();
  toast('Nómina guardada.');
}

// ---------- Ahorro ----------
function savings() {
  const per = periods();
  const total = goalsTotal();
  const bal = db.account.balance ?? db.movements[0]?.balance ?? 0;
  const head = `<header class="top"><h1>Ahorro</h1></header>`;
  const hero = `<section class="hero"><p>Apartado en objetivos</p><div class="big">${eur(total)}</div>
    <small>${db.movements.length ? `De tu saldo de ${eur(bal)}, quedan ${eur(bal - total)} sin asignar` : 'Importa un extracto para ver tu saldo'}</small></section>`;
  const done = per.filter((p) => p.pay && p.to);
  const rate = done.length ? Math.round((done[0].saved / (done[0].income || 1)) * 100) : null;
  const shown = per.filter((p) => p.pay).slice(0, 6).reverse();
  const max = Math.max(1, ...shown.map((p) => Math.abs(p.saved)));
  const chart = shown.length ? `<section class="card"><div class="card-head"><h2>Lo que ahorras por nómina</h2>${rate != null ? `<span class="tag">${rate} % la última</span>` : ''}</div>
    <div class="cols">${shown.map((p) => `<div class="col"><span class="val">${eur0(p.saved)}</span><i class="${p.saved < 0 ? 'neg' : ''}" style="height:${Math.max(4, (Math.abs(p.saved) / max) * 100)}%"></i><small>${short(p.from)}${p.to ? '' : ' ·'}</small></div>`).join('')}</div>
    <p class="hint">Ingresos menos gastos entre una nómina y la siguiente.${shown.some((p) => !p.to) ? ' El periodo marcado con · sigue abierto.' : ''}</p></section>` : '';
  const lastPay = paydays().pop();
  const tip = lastPay ? `<p class="tip">💡 El ${db.settings.savePct} % de tu última nómina son <b>${eur(lastPay.amount * db.settings.savePct / 100)}</b>. Apártalos nada más cobrar y repártelos entre tus objetivos.</p>` : '';
  const avg = done.length ? done.reduce((a, p) => a + p.saved, 0) / done.length : 0;
  const goals = db.goals.map((g) => {
    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
    const left = g.target - g.saved;
    const eta = left <= 0 ? '¡Conseguido! 🎉' : g.due ? dueTxt(g) : avg > 0 ? `A tu ritmo, en unos ${Math.ceil(left / avg)} meses` : `Faltan ${eur(left)}`;
    return `<button class="goal" data-act="goal" data-id="${g.id}"><span class="goal-top"><span class="bubble" style="--c:#1f9d6b">${g.emoji}</span><span class="row-main"><b>${esc(g.name)}</b><small>${eta}</small></span><span class="pct">${pct} %</span></span>
      <span class="bar"><i style="width:${pct}%"></i></span><span class="goal-sub"><span>${eur(g.saved)}</span><span>de ${eur(g.target)}</span></span></button>`;
  }).join('');
  return head + hero + chart + `<h3 class="day">Objetivos</h3>` +
    (goals || `<section class="card"><p class="hint">Crea tu primer objetivo: un fondo de emergencia de 3 meses de gastos es un buen comienzo.</p></section>`) +
    tip + `<div class="actions"><button class="btn" data-act="goal-new">＋ Nuevo objetivo</button></div>`;
}

const EMOJIS = ['🛟', '✈️', '🏠', '🚗', '💻', '🎓', '🎁', '🏖️', '💍', '🐷', '🐱'];
const fmtDue = (iso) => { const d = toDate(iso); return `${d.getDate()} ${MES[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };
function monthsTo(iso) {
  const a = toDate(todayIso()), b = toDate(iso);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) - (b.getDate() < a.getDate() ? 1 : 0);
}
// Qué falta para un objetivo con fecha: cuánto apartar al mes.
function dueTxt(g) {
  const left = g.target - g.saved;
  if (!g.due || left <= 0) return '';
  if (dayDiff(todayIso(), g.due) < 0) return `Fecha pasada (${fmtDue(g.due)}) · faltan ${eur(left)}`;
  const m = monthsTo(g.due);
  return m < 1 ? `Para el ${fmtDue(g.due)}: faltan ${eur(left)}` : `Para el ${fmtDue(g.due)}: aparta ${eur0(Math.ceil(left / m))} al mes`;
}
function goalForm(g) {
  state.draft = g ? { ...g } : { emoji: '🛟' };
  openSheet(`<h2>${g ? 'Editar objetivo' : 'Nuevo objetivo'}</h2>
    <label class="field"><span>Nombre</span><input id="f-name" type="text" placeholder="Fondo de emergencia" value="${esc(g?.name || '')}" /></label>
    <label class="field"><span>Cantidad a conseguir (€)</span><input id="f-target" type="text" inputmode="decimal" placeholder="3000" value="${g ? String(g.target).replace('.', ',') : ''}" /></label>
    <label class="field"><span>Fecha objetivo (opcional)</span><input id="f-due" type="date" min="${todayIso()}" value="${g?.due || ''}" /></label>
    <div class="field"><span>Icono</span><div class="emojis">${EMOJIS.map((e) => `<button class="emoji ${e === state.draft.emoji ? 'on' : ''}" data-act="emoji" data-e="${e}">${e}</button>`).join('')}</div></div>
    <div class="actions"><button class="btn" data-act="goal-save">Guardar</button></div>`);
}
function goalSheet(g) {
  const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
  openSheet(`<h2>${g.emoji} ${esc(g.name)}</h2>
    <div class="big center">${eur(g.saved)}</div><p class="hint center">de ${eur(g.target)} · ${pct} %${g.due ? '<br />' + (dueTxt(g) || 'Fecha objetivo: ' + fmtDue(g.due)) : ''}</p><div class="bar"><i style="width:${pct}%"></i></div>
    <label class="field"><span>Cantidad (€)</span><input id="f-amount" type="text" inputmode="decimal" placeholder="50" /></label>
    <div class="chips">${[...new Set([10, 20, 50, g.due && g.target > g.saved && monthsTo(g.due) >= 1 ? Math.ceil((g.target - g.saved) / monthsTo(g.due)) : null, g.target > g.saved ? +(g.target - g.saved).toFixed(2) : null].filter(Boolean))].map((v) => `<button class="chip" data-act="amt" data-v="${v}">${eur(v).replace(',00', '')}</button>`).join('')}</div>
    <div class="actions"><button class="btn" data-act="goal-add" data-id="${g.id}" data-sign="1">Aportar</button><button class="btn ghost" data-act="goal-add" data-id="${g.id}" data-sign="-1">Retirar</button></div>
    <div class="actions"><button class="btn ghost" data-act="goal-edit" data-id="${g.id}">Editar</button><button class="btn danger" data-act="goal-del" data-id="${g.id}">Eliminar</button></div>`);
}

// ---------- ubicación de un aviso ----------
function geoBlock(g) {
  const name = [g.address, g.locality].filter(Boolean).join(', ');
  const acc = g.acc ? ' · precisión ~' + Math.round(g.acc) + ' m' : '';
  const old = g.age > 120 ? ' · posición de hace ' + Math.round(g.age / 60) + ' min' : '';
  return `<p class="tip">📍 <b>${name ? esc(name) : 'Ubicación guardada'}</b>${acc}${old}<br />
    <a class="maplink" href="https://www.google.com/maps?q=${g.lat},${g.lon}" target="_blank" rel="noopener">Ver en el mapa</a><br />
    <small class="muted">Es dónde estabas cuando llegó el aviso; no tiene por qué ser el comercio.</small></p>`;
}

// ---------- categoría de un movimiento ----------
function movSheet(m) {
  const c = CATS[m.cat] || CATS.otros;
  const options = Object.entries(CATS).filter(([, v]) => !!v.income === m.amount > 0 || (m.amount < 0 && !v.income));
  openSheet(`<h2>${esc(m.title)}</h2><p class="hint">${long(m.date)}${m.note ? ' · ' + esc(m.note) : ''}</p>
    <div class="big center ${m.amount > 0 ? 'pos' : ''}">${signed(m.amount)}</div>
    <p class="hint center">${c.icon} ${c.name}${m.balance != null ? ' · saldo después ' + eur(m.balance) : ''}</p>
    ${m.raw ? `<p class="tip">🔔 «${esc(m.raw)}»</p>` : ''}
    ${m.geo ? geoBlock(m.geo) : ''}
    ${m.manual || m.pending ? `<div class="actions"><button class="btn ghost" data-act="mov-edit" data-id="${esc(m.id)}">Editar</button><button class="btn danger" data-act="mov-del" data-id="${esc(m.id)}">${m.pending ? 'Descartar aviso' : 'Eliminar apunte'}</button></div>` : ''}
    <h3>Cambiar categoría</h3>
    <div class="catgrid">${options.map(([k, v]) => `<button class="catopt ${k === m.cat ? 'on' : ''}" data-act="setcat" data-id="${esc(m.id)}" data-cat="${k}"><span>${v.icon}</span>${v.name}</button>`).join('')}</div>
    <p class="hint">Se aplicará a todos los movimientos de «${esc(m.title)}», también a los que importes más adelante.</p>`);
}

// ---------- palabras clave ----------
function kwSection() {
  const kw = db.catKeywords || {};
  const chips = Object.entries(kw).flatMap(([cat, ws]) => ws.map((w) => `<button class="kw" data-act="kw-del" data-cat="${cat}" data-w="${esc(w)}" aria-label="Quitar ${esc(w)}">${CATS[cat]?.icon || ''} ${esc(w)} <span>×</span></button>`)).join('');
  const opts = Object.entries(CATS).filter(([k, v]) => !v.income && k !== 'ahorro').map(([k, v]) => `<option value="${k}" ${k === 'mascota' ? 'selected' : ''}>${v.icon} ${v.name}</option>`).join('');
  return `<p class="hint">Si el comercio o el concepto contiene la palabra, el gasto va a esa categoría. Se suman a las reglas que ya trae la app (Zooplus, Tiendanimal, Kiwoko, «veterinari» y «protectora» van a Mascota).</p>
    ${chips ? `<div class="kws">${chips}</div>` : ''}
    <div class="grid2"><label class="field"><span>Palabra</span><input id="f-kw" type="text" placeholder="arenero, peluquería…" /></label>
    <label class="field"><span>Categoría</span><select id="f-kwcat">${opts}</select></label></div>
    <div class="actions"><button class="btn ghost" data-act="kw-add">Añadir palabra</button></div>`;
}

// ---------- ajustes ----------
function settingsSheet() {
  openSheet(`<h2>Ajustes</h2>
    <label class="field"><span>Porcentaje de la nómina que quieres ahorrar</span><input id="f-pct" type="text" inputmode="numeric" value="${db.settings.savePct}" /></label>
    <div class="actions"><button class="btn" data-act="pct-save">Guardar</button></div>
    <h3>Aspecto</h3>
    <button class="row news-link" data-act="layout"><span class="bubble" style="--c:#4f8fd9">🧩</span><span class="row-main"><b>Personalizar barra e Inicio</b><small>Ordena y oculta pestañas y tarjetas. También manteniendo pulsada la barra</small></span><span class="chev">›</span></button>
    <div class="seg three">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) => `<button class="${(db.settings.theme || 'auto') === k ? 'on' : ''}" data-act="theme" data-t="${k}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" data-act="hide-money" ${db.settings.hideMoney ? 'checked' : ''} /><span class="row-main"><b>Ocultar importes</b><small>Los difumina; también con el ojo de Inicio</small></span></label>
    <h3>Palabras clave de categorías</h3>
    ${kwSection()}
    <h3>Bloqueo</h3>
    ${db.settings.lock ? `<p class="hint">Activado: la app pide ${native.bio ? 'tu huella o el PIN' : 'el PIN'} al abrirla.</p>
      <label class="field"><span>PIN actual, para quitarlo</span><input id="f-pin-old" type="password" inputmode="numeric" maxlength="4" autocomplete="off" /></label>
      <div class="actions"><button class="btn ghost" data-act="lock-off">Quitar bloqueo</button></div>`
    : `<p class="hint">Pide un PIN de 4 cifras${native.bio ? ' o tu huella' : ''} al abrir la app. Si olvidas el PIN no se puede recuperar: tendrías que borrar los datos de la app y restaurar una copia.</p>
      <div class="grid2"><label class="field"><span>PIN nuevo</span><input id="f-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" /></label>
      <label class="field"><span>Repítelo</span><input id="f-pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off" /></label></div>
      <div class="actions"><button class="btn ghost" data-act="lock-on">Activar bloqueo</button></div>`}
    <h3>Avisos del banco</h3>
    ${!Noti ? '<p class="hint">Disponible en la app del móvil: apunta al momento los pagos y cobros que te notifica el banco.</p>'
    : native.noti ? '<p class="hint">Activado ✓ Los pagos y cobros que te notifique el banco aparecen al momento como «pendientes» y se sustituyen por el dato real al importar el extracto.</p>'
    : `<p class="hint">Deja que la app lea las notificaciones de tu banco para apuntar cada pago al momento. Solo guarda los avisos con un importe y nada sale del móvil.</p>
      <div class="actions"><button class="btn ghost" data-act="noti-perm">Dar permiso</button></div>
      <p class="hint">Si Android muestra «Mi Hucha» en gris: Ajustes del móvil → Aplicaciones → Mi Hucha → menú ⋮ → «Permitir ajustes restringidos», y vuelve a intentarlo.</p>`}
    ${notiDiag()}
    <h3>Ubicación de los pagos</h3>
    ${geoSection()}
    <h3>Botón atrás</h3>
    <label class="check"><input type="checkbox" data-act="exit-ask" ${db.settings.exitNoAsk ? '' : 'checked'} /><span class="row-main"><b>Preguntar antes de salir</b><small>Al ir atrás desde Inicio</small></span></label>
    <h3>Recordatorios</h3>
    <p class="hint">${db.settings.remind ? 'Activados: te aviso a los 15 días sin importar y al día siguiente de cobrar.' : 'Desactivados.'}</p>
    <div class="actions"><button class="btn ghost" data-act="remind" data-on="${db.settings.remind ? 0 : 1}">${db.settings.remind ? 'Desactivar avisos' : 'Activar avisos'}</button></div>
    <h3>Actualizar</h3>
    <button class="row news-link" data-act="news"><span class="bubble" style="--c:#1f9d6b">📰</span><span class="row-main"><b>Novedades</b><small>Lo nuevo de la versión ${__APP_VERSION__} y de las anteriores</small></span><span class="chev">›</span></button>
    <p class="hint">Versión ${__APP_VERSION__}${__BUILD_SHA__ ? ` · ${__BUILD_SHA__.slice(0, 7)}` : ''}. Descarga la última versión subida a GitHub y la instala encima, sin perder tus datos.</p>
    <label class="check"><input type="checkbox" data-act="upd-auto" ${db.settings.updAuto === false ? '' : 'checked'} /><span class="row-main"><b>Avisarme de versiones nuevas</b><small>Lo comprueba cada vez que abres la app</small></span></label>
    <div class="actions"><button class="btn ghost" data-act="update">Buscar actualización</button></div>
    <h3>Tus datos</h3>
    <p class="hint">Todo se guarda solo en este móvil. Haz una copia de vez en cuando para no perderlo si cambias de teléfono. <b>${db.settings.lastBackup ? `Última copia: ${daysAgo(db.settings.lastBackup)}.` : 'Aún no has hecho ninguna copia.'}</b></p>
    <div class="actions"><button class="btn ghost" data-act="export">Exportar copia</button><button class="btn ghost" data-act="restore">Restaurar copia</button></div>
    <div class="actions"><button class="btn danger" data-act="wipe">Borrar todos los datos</button></div>`);
}

async function exportBackup() {
  const name = `mi-hucha-${todayIso()}.json`;
  db.settings.lastBackup = todayIso(); save();
  const json = JSON.stringify({ ...db, settings: { ...db.settings, lock: undefined } }, null, 1);
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const r = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'Copia de Mi Hucha', url: r.uri });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    a.click();
  }
}

// ---------- importar PDF ----------
let pdfjs;
async function readPdf(src) {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const W = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?worker')).default;
    pdfjs.GlobalWorkerOptions.workerPort = new W();
  }
  const doc = await pdfjs.getDocument({ data: src instanceof Uint8Array ? src : new Uint8Array(await src.arrayBuffer()) }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.map((i) => ({ x: i.transform[4], y: i.transform[5], str: i.str })));
  }
  return pages;
}

async function importPdf(file) {
  toast('Leyendo el PDF…');
  let pages;
  try { pages = await readPdf(file); } catch (e) { console.error(e); return toast('No he podido abrir ese PDF.'); }
  if (!pages.flat().some((i) => i.str.trim())) return toast('Ese PDF es una imagen escaneada y no tiene texto. Añade la nómina a mano.');
  const type = detectType(pages);
  if (type === 'bank') {
    const bank = parseBank(pages);
    if (!bank.movements.length) return toast('No he encontrado movimientos en el PDF.');
    const added = mergeBank(db, bank);
    db.settings.lastImport = todayIso();
    db.settings.lastImportAt = Date.now();
    save(); render(); scheduleReminders();
    toast(added ? `${added} movimientos nuevos añadidos.` : 'Ese extracto ya estaba importado: no hay nada nuevo.');
  } else if (type === 'payslip') {
    slipForm(parsePayslip(pages));
  } else toast('No reconozco este PDF. Sirven extractos del banco y nóminas.');
}

// ---------- saldo estimado ----------
function balanceInfo() {
  const base = db.account.balance ?? db.movements.find((m) => m.balance != null)?.balance ?? 0;
  const extra = db.movements.filter((m) => m.pending && m.time > (db.settings.lastImportAt || 0));
  return { value: base + extra.reduce((a, m) => a + m.amount, 0), n: extra.length };
}
function heroSub() {
  const n = balanceInfo().n;
  const when = db.account.balanceDate ? short(db.account.balanceDate) : '';
  if (n) return `Estimado: extracto${when ? ' del ' + when : ''} + ${n} ${n === 1 ? 'aviso' : 'avisos'} del banco`;
  return when ? 'Actualizado el ' + when : '';
}

// ---------- topes de gasto ----------
function barStyle(k, v, max, color) {
  const u = budgetUse(k);
  if (!u) return `width:${Math.max(3, (v / max) * 100)}%;background:${color}`;
  const r = u.monthly ? u.r : v / u.b;
  return `width:${Math.min(100, Math.max(3, r * 100))}%;background:${r > 1 ? 'var(--neg)' : r >= 0.8 ? '#e0a43a' : color}`;
}
// Texto corto del tope para las filas de categoría.
function budTxt(k) {
  const u = budgetUse(k);
  if (!u) return '';
  return u.monthly ? `${eur0(u.spent)} de ${eur0(u.b)} este mes` : `tope ${eur0(u.b)}`;
}
function budgetSheet() {
  const done = periods().filter((p) => p.pay && p.to);
  const avg = (k) => (done.length ? done.reduce((a, p) => a + (p.byCat[k] || 0), 0) / done.length : 0);
  openSheet(`<h2>Topes de gasto</h2>
    <p class="hint">Lo máximo que quieres gastar en cada categoría, entre una nómina y la siguiente o por mes natural. Te aviso al llegar al 80 % y al pasarte. Deja en blanco las que no quieras controlar.</p>
    ${Object.entries(CATS).filter(([k, v]) => !v.income && k !== 'ahorro').map(([k, v]) => `<label class="budget">
      <span class="bubble" style="--c:${v.color}">${v.icon}</span>
      <span class="row-main"><b>${v.name}</b><small>${avg(k) ? 'Sueles gastar ' + eur0(avg(k)) : 'Sin gasto habitual'}</small></span>
      <input data-bud="${k}" type="text" inputmode="decimal" placeholder="—" value="${db.budgets[k] ? String(db.budgets[k]).replace('.', ',') : ''}" />
      <select data-budp="${k}" aria-label="Periodo del tope"><option value="p">/nóm.</option><option value="m" ${db.settings.budgetMonthly?.[k] ? 'selected' : ''}>/mes</option></select></label>`).join('')}
    <div class="actions"><button class="btn" data-act="budget-save">Guardar topes</button></div>`);
}

// ---------- previsión de la renta ----------
const pctTxt = (n) => String(+n.toFixed(1)).replace('.', ',');
const ln = (l, v, cls = '') => `<div class="line ${cls}"><span>${l}</span><b>${v}</b></div>`;
function taxHeadline(f) {
  if (f.result <= 0) return { t: `Te devolverían unos ${eur0(-f.result)}`, cls: 'pos' };
  return f.obliged ? { t: `Te saldría a pagar unos ${eur0(f.result)}`, cls: 'neg' } : { t: 'No tendrías que declarar', cls: '' };
}
function taxCard() {
  const f = forecast(db, new Date().getFullYear());
  if (!f) return '';
  const h = taxHeadline(f), n = taxHeadline(f.next);
  return `<button class="pay" data-act="tax">
    <span class="pay-top"><span><small>Previsión de la renta ${f.year}</small><b class="mid ${h.cls}">${h.t}</b></span><span class="bubble" style="--c:#d1a13a">🧾</span></span>
    <span class="pay-sub">Bruto estimado del año: ${eur0(f.gross)} · te retienen el ${pctTxt(f.pct)} %</span>
    <span class="pay-sub">Si trabajas todo ${f.next.year}: ${n.t.toLowerCase()}${!f.next.obliged && f.next.result > 0 ? `, aunque si declarases serían unos ${eur0(f.next.result)} a pagar` : ''}. Toca para ver el detalle.</span>
  </button>`;
}
function taxSheet() {
  const f = forecast(db, new Date().getFullYear());
  const h = taxHeadline(f), x = f.next;
  const limit = f.otherGross > SECOND_PAYER_MIN ? LIMIT_TWO_PAYERS : LIMIT_ONE_PAYER;
  let why;
  if (f.result <= 0) why = `Te habrán retenido más de lo que te toca pagar. Aunque no estés obligado, te conviene presentar la declaración para recuperar esa diferencia.`;
  else if (f.obliged) why = `Superas el límite de ${eur0(limit)} brutos, así que tendrías que declarar y pagar la diferencia. Ve apartando unos <b>${eur0(f.result / Math.max(1, f.monthsLeft))} al mes</b> o pide a la empresa que te suba la retención.`;
  else why = `Con menos de ${eur0(limit)} brutos no estás obligado a declarar, y como te saldría a pagar unos ${eur0(f.result)}, lo normal es no presentarla.`;
  openSheet(`<h2>Renta ${f.year}</h2>
    <div class="big center mid ${h.cls}">${h.t}</div>
    <p class="hint">${why}</p>
    ${ln('Bruto de tus nóminas guardadas', eur(f.realGross))}
    ${f.estGross ? ln('Cobros sin nómina guardada (estimado)', eur(f.estGross)) : ''}
    ${ln(`Meses que faltan (${f.monthsLeft} × ${eur0(f.monthly)})`, eur(f.futureGross))}
    ${f.otherGross ? ln('Otros pagadores', eur(f.otherGross)) : ''}
    ${ln('Bruto estimado del año', eur(f.gross), 'sum')}
    ${ln('Impuesto estimado', eur(f.quota))}
    ${ln('Retenciones estimadas', '−' + eur(f.withheld))}
    ${ln(f.result > 0 ? 'Diferencia a pagar' : 'Diferencia a devolver', eur(Math.abs(f.result)), 'sum')}
    <h3>Si trabajas todo ${x.year} con este sueldo</h3>
    ${ln('Bruto anual', eur(x.gross))}
    ${ln('Impuesto estimado', eur(x.quota))}
    ${ln(`Retenciones al ${pctTxt(f.pct)} %`, '−' + eur(x.withheld))}
    ${ln(x.result > 0 ? 'Diferencia a pagar' : 'Diferencia a devolver', eur(Math.abs(x.result)), 'sum')}
    <p class="tip">💡 ${x.obliged
      ? `Tendrías que declarar. Para que no te salga a pagar, la retención debería rondar el <b>${pctTxt(x.neededPct)} %</b>.`
      : x.result > 0
        ? `Con un solo pagador y menos de ${eur0(LIMIT_ONE_PAYER)} brutos no tendrías que declarar ni pagar esa diferencia. Pero si en el año cobras más de ${eur0(SECOND_PAYER_MIN)} de un segundo pagador (otra empresa, el paro), el límite baja a ${eur0(LIMIT_TWO_PAYERS)} y sí te tocaría: unos <b>${eur0(x.result)}</b>. Para evitarlo, la retención debería rondar el <b>${pctTxt(x.neededPct)} %</b>.`
        : 'Te saldría a devolver.'}</p>
    <h3>¿Has tenido otro pagador en ${f.year}?</h3>
    <p class="hint">Otra empresa, otra ETT o el paro. Apunta lo cobrado en bruto y lo que te retuvieron.</p>
    <div class="grid2"><label class="field"><span>Bruto de otros (€)</span><input id="f-ogross" type="text" inputmode="decimal" value="${f.otherGross ? String(f.otherGross).replace('.', ',') : ''}" /></label>
    <label class="field"><span>Retenido (€)</span><input id="f-oret" type="text" inputmode="decimal" value="${f.otherRet ? String(f.otherRet).replace('.', ',') : ''}" /></label></div>
    <div class="actions"><button class="btn" data-act="tax-save">Recalcular</button></div>
    <p class="hint">Cálculo orientativo para una persona soltera sin hijos, con la escala general. No tiene en cuenta deducciones autonómicas ni personales. El dato definitivo lo da el simulador de la Agencia Tributaria.</p>`);
}

// ---------- bloqueo con PIN y huella ----------
const lockEl = $('#lock');
const native = { bio: false, noti: false, geo: {} };
const Bio = Capacitor.isNativePlatform() ? registerPlugin('Biometric') : null;
const Noti = Capacitor.isNativePlatform() ? registerPlugin('BankNoti') : null;
const Upd = Capacitor.isNativePlatform() ? registerPlugin('Updater') : null;

// ---------- actualizar desde GitHub ----------
// Ventana con la barra de descarga y el porcentaje.
function progressBox() {
  const box = document.createElement('div');
  box.className = 'upd';
  box.innerHTML = `<div class="upd-card" role="dialog" aria-label="Descargando actualización">
    <div class="upd-icon">⬇️</div>
    <b class="upd-title">Descargando actualización</b>
    <div class="upd-pct" aria-live="polite">0 %</div>
    <div class="upd-track indet"><div class="upd-fill"></div></div>
    <small class="upd-size">Conectando con GitHub…</small></div>`;
  document.body.appendChild(box);
  const $q = (s) => box.querySelector(s);
  const mb = (b) => (b / 1048576).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return {
    set(done, total) {
      if (total > 0) {
        const pct = Math.min(100, Math.floor((done * 100) / total));
        $q('.upd-track').classList.remove('indet');
        $q('.upd-fill').style.width = pct + '%';
        $q('.upd-pct').textContent = pct + ' %';
        $q('.upd-size').textContent = `${mb(done)} de ${mb(total)} MB`;
      } else $q('.upd-size').textContent = `${mb(done)} MB descargados`;
    },
    finish() {
      $q('.upd-track').classList.remove('indet');
      $q('.upd-fill').style.width = '100%';
      $q('.upd-pct').textContent = '100 %';
      $q('.upd-title').textContent = 'Lista para instalar';
      $q('.upd-icon').textContent = '✅';
      $q('.upd-size').textContent = 'Abriendo el instalador de Android…';
      box.classList.add('done');
      setTimeout(() => this.close(), 2500);
    },
    close() { box.classList.add('out'); setTimeout(() => box.remove(), 200); },
  };
}

const REPO = 'alebarzal/mi-hucha';
async function checkUpdate(el) {
  const label = el.textContent;
  el.disabled = true; el.textContent = 'Buscando…';
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/latest`, { cache: 'no-store' });
    if (r.status === 404) return toast('Todavía no hay ninguna versión publicada en GitHub.');
    if (!r.ok) throw new Error();
    const rel = await r.json();
    const apk = (rel.assets || []).find((a) => a.name.endsWith('.apk'));
    if (!apk) return toast('La última versión aún se está preparando. Prueba en unos minutos.');
    db.settings.updAvail = rel.target_commitish; db.settings.updCheckAt = Date.now(); save();
    if (__BUILD_SHA__ && rel.target_commitish === __BUILD_SHA__) return toast('Ya tienes la última versión ✓');
    const d = new Date(rel.published_at);
    const when = `${d.getDate()} ${MES[d.getMonth()]} a las ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (el.dataset.direct) closeSheet();
    else if (!confirm(`Hay una versión nueva (${when}):
${rel.body || ''}

¿Descargarla e instalarla? Tus datos se mantienen.`)) return;
    if (!Upd) { window.open(apk.browser_download_url, '_blank'); return; }
    const { allowed } = await Upd.canInstall();
    if (!allowed) {
      toast('Permite a Mi Hucha instalar aplicaciones y vuelve a pulsar «Buscar actualización».');
      await Upd.openInstallSettings();
      return;
    }
    const bar = progressBox();
    const sub = await Upd.addListener('progress', (p) => bar.set(p.done, p.total));
    try {
      await Upd.install({ url: apk.browser_download_url });
      bar.finish();
    } catch (e) { bar.close(); throw e; } finally { sub.remove(); }
  } catch (e) {
    toast(e?.message || 'No se pudo comprobar. ¿Tienes conexión?');
  } finally { el.disabled = false; el.textContent = label; }
}
// Al abrir la app mira si hay versión nueva: la anuncia con un aviso y una tarjeta en Inicio.
let updShown = '', updPending = false;
const updInfo = () => {
  const body = (db.settings.updNotes || '').trim();
  const m = body.match(/^(\d+\.\d+):\s*(.*)$/);
  return m ? { v: m[1], text: m[2] } : { v: '', text: body };
};
function updatePopup() {
  if (!sheet.hidden || !lockEl.hidden) { updPending = true; return; }
  updPending = false;
  updShown = db.settings.updAvail;
  const { v, text } = updInfo();
  openSheet(`<div class="upd-pop">
    <div class="upd-pop-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.500 10.500L12 15l4.500-4.500"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg></div>
    ${v ? `<span class="tag">Versión ${esc(v)}</span>` : ''}
    <h2>Hay una actualización</h2>
    <p class="hint">${text ? esc(text.charAt(0).toUpperCase() + text.slice(1)) + '.' : 'Hay una versión nueva de Mi Hucha.'} Se instala encima en unos segundos y tus datos se mantienen.</p>
    <div class="actions"><button class="btn ghost" data-act="close">Más tarde</button><button class="btn" data-act="update" data-direct="1">Actualizar</button></div>
  </div>`);
}
if (import.meta.env.DEV) window.__updatePopup = updatePopup; // para probar el aviso en el navegador
async function autoCheckUpdate() {
  if (!Upd || db.settings.updAuto === false || !__BUILD_SHA__) return;
  if (Date.now() - (db.settings.updCheckAt || 0) < 10 * 60e3) {
    if (db.settings.updAvail && db.settings.updAvail !== __BUILD_SHA__ && updShown !== db.settings.updAvail) updatePopup();
    return;
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/latest`, { cache: 'no-store' });
    if (!r.ok) return;
    const rel = await r.json();
    if (!(rel.assets || []).some((a) => a.name.endsWith('.apk'))) return;
    db.settings.updCheckAt = Date.now();
    db.settings.updAvail = rel.target_commitish;
    db.settings.updNotes = (rel.body || '').replace(/^Compilada a partir de \w+: /, '').slice(0, 200);
    save();
    if (rel.target_commitish === __BUILD_SHA__) return;
    if (state.tab === 'home' && sheet.hidden) render();
    if (updShown !== rel.target_commitish) updatePopup();
  } catch { /* sin conexión: se reintenta al abrir */ }
}
let pinBuf = '';
let hiddenAt = 0;
async function sha(salt, pin) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Huella dactilar dibujada con trazos (sigue el color del tema).
const FINGERPRINT = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6.300 5.200A8.400 8.400 0 0 1 12 3c2.200 0 4.200.8 5.700 2.200"/>
  <path d="M3.600 10.200A8.600 8.600 0 0 1 5 7.400M20.400 10.400a8.700 8.700 0 0 0-1.300-3"/>
  <path d="M5.800 17.600A11 11 0 0 1 5 13.400a7 7 0 0 1 14 0v.6"/>
  <path d="M8.500 20a9.600 9.600 0 0 1-1.200-5.800 4.700 4.700 0 0 1 9.400.2c0 1.900-.2 3.700-.7 5.400"/>
  <path d="M12 13.300c0 2.900.5 5.300 1.400 7.400"/>
  <path d="M18.700 17.600c.2-.9.300-1.800.300-2.800"/>
  <path d="M10.200 21.200c-.6-1.400-1-3.300-1-6.600a2.800 2.800 0 0 1 5.600 0c0 1.200.1 2.300.3 3.300"/>
</svg>`;
function drawLock(msg) {
  const bio = native.bio && db.settings.lock?.bio;
  lockEl.innerHTML = `<div class="lock-box"><div class="lock-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.500" y="10.500" width="15" height="10.500" rx="2.500"/><path d="M8 10.500V7.500a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.500" r="1.300" class="fill"/></svg></div><h2>Mi Hucha</h2><p class="hint">${msg || 'Escribe tu PIN'}</p>
    <div class="dots">${[0, 1, 2, 3].map((i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="key" data-k="${n}">${n}</button>`).join('')}
    <button class="key-ico bio" data-act="bio" aria-label="Usar huella" ${bio ? '' : 'style="visibility:hidden"'}>${FINGERPRINT}</button><button data-act="key" data-k="0">0</button><button class="key-ico" data-act="key" data-k="del" aria-label="Borrar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10.500A1.500 1.500 0 0 1 21 6.500v11a1.500 1.500 0 0 1-1.500 1.500H9l-6-7z"/><path d="M12.500 9.500l5 5M17.500 9.500l-5 5"/></svg></button></div></div>`;
}
function lockNow() {
  if (!db.settings.lock) return;
  pinBuf = '';
  lockEl.hidden = false;
  drawLock();
}
function unlock() {
  lockEl.hidden = true;
  lockEl.innerHTML = '';
  setTimeout(maybeShowNews, 300);
  if (updPending) setTimeout(updatePopup, 400);
}
async function tryBio() {
  if (lockEl.hidden || !Bio || !native.bio || !db.settings.lock?.bio) return;
  const r = await Bio.verify().catch(() => ({ ok: false }));
  if (r.ok) unlock();
}
async function refreshNative() {
  if (!Capacitor.isNativePlatform()) return;
  native.bio = !!(await Bio.available().catch(() => ({}))).value;
  const st = await Noti.status().catch(() => ({}));
  native.noti = !!st.enabled;
  native.seen = st.seen || 0;
  native.lastSeen = st.lastSeen || 0;
  native.geo = await Noti.geoStatus().catch(() => ({}));
}

// ---------- avisos del banco ----------
const hhmm = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function notiDiag() {
  if (!Noti || !native.noti) return '';
  const log = db.notiLog || [];
  return `<p class="hint"><b>Diagnóstico.</b> Notificaciones de apps de banco vistas: ${native.seen}${native.lastSeen ? ' (última: ' + hhmm(native.lastSeen) + ')' : ''}. ${native.seen ? '' : 'Si sigue en 0 después de recibir un aviso del banco, Android no se los está pasando a la app.'}</p>
    ${log.map((l) => `<div class="diag"><small>${hhmm(l.time)} · <b>${esc(l.res)}</b>${l.geo ? ' · 📍 ' + esc(l.geo) : ''}</small><span>${esc(l.text)}</span></div>`).join('')}`;
}
async function takeNotis() {
  if (!Noti) return;
  const { items } = await Noti.take();
  let n = 0;
  if (!items?.length) return nameGeos();
  const log = db.notiLog || [];
  for (const it of items) {
    const m = parseNoti(it);
    if (!m.skip && it.lat != null) m.geo = { lat: it.lat, lon: it.lon, acc: it.acc, age: it.locAge, fresh: it.fresh };
    const res = m.skip ? 'ignorado: ' + m.skip : addPending(m);
    if (res === 'added') n++;
    log.unshift({ time: it.time, text: (it.title + ' · ' + it.text).slice(0, 160), res: res === 'added' ? 'apuntado' : res === 'merged' ? 'unido a otro aviso' : res || 'repetido', geo: it.geoState });
  }
  db.notiLog = log.slice(0, 12);
  save(); render();
  nameGeos();
  if (!n) return;
  toast(n === 1 ? '1 aviso del banco añadido.' : `${n} avisos del banco añadidos.`);
}

// Pone nombre (ciudad y calle) a las ubicaciones guardadas; si no hay red, se reintenta al abrir.
async function nameGeos() {
  if (!Noti) return;
  let changed = false;
  let left = 6;
  for (const m of db.movements) {
    if (left <= 0) break;
    if (!m.pending || !m.geo || m.geo.done || (m.geo.tries || 0) >= 5) continue;
    left--;
    m.geo.tries = (m.geo.tries || 0) + 1;
    const r = await Noti.geocode({ lat: m.geo.lat, lon: m.geo.lon }).catch(() => ({}));
    if (r.locality || r.address) { Object.assign(m.geo, { locality: r.locality || '', address: r.address || '', country: r.country || 'ES', done: true }); changed = true; }
  }
  if (changed) { save(); render(); } else if (left < 6) save();
}

function geoSection() {
  if (!Noti) return '<p class="hint">Disponible en la app del móvil: guarda dónde estabas cuando llega un aviso del banco.</p>';
  const g = native.geo || {};
  let state = '';
  if (g.on) {
    if (!g.fine) state = '<p class="hint">Falta el permiso de ubicación.</p><div class="actions"><button class="btn ghost" data-act="geo-perm">Dar permiso de ubicación</button></div>';
    else if (!g.background) state = '<p class="hint">Falta un paso: para leer tu posición cuando la app está cerrada, Android pide «Permitir todo el tiempo». Pulsa el botón: si Android abre los ajustes de la app, entra en Permisos → Ubicación y elige «Permitir todo el tiempo».</p><div class="actions"><button class="btn ghost" data-act="geo-bg">Permitir «todo el tiempo»</button><button class="btn ghost" data-act="app-settings">Abrir ajustes</button></div>';
    else state = '<p class="hint">Activada ✓ Cuando llegue un aviso con importe, guardo dónde estás.</p>';
  }
  return `<label class="check"><input type="checkbox" data-act="geo-toggle" ${g.on ? 'checked' : ''} /><span class="row-main"><b>Guardar dónde estoy al llegar un aviso</b><small>Solo en ese instante, no sigo tu ruta</small></span></label>${state}
    <p class="hint">La ubicación se guarda solo en el móvil. Para convertirla en ciudad y calle, Android puede consultar el servicio de direcciones de Google, que recibiría esas coordenadas.</p>`;
}

// ---------- lugares y viajes ----------
const placeLabel = (p) => p.name + (p.country !== 'ES' ? ` · ${p.countryName}` : '');
const range = (from, to) => (from === to ? short(from) : `${short(from)} – ${short(to)}`);
const askHomeCard = () => `<section class="card"><div class="card-head"><h2>📍 ¿Dónde vives?</h2></div>
  <p class="hint">Así sé qué pagos son de tu día a día y cuáles de un viaje, para decirte cuánto te gastas cuando sales fuera.</p>
  <div class="actions"><button class="btn" data-act="home-ask">Elegir mi zona</button></div></section>`;

function homeSheet() {
  const stats = placeStats(db);
  const city = db.settings.city || stats.slice().sort((a, b) => b.days - a.days)[0]?.name || '';
  const checked = new Set(db.settings.home || suggestHome(db, city));
  const known = new Set(stats.map((s) => s.key));
  const extra = (db.settings.home || []).filter((k) => !known.has(k) && k !== norm(city));
  openSheet(`<h2>¿Dónde vives?</h2>
    <p class="hint">Escribe tu ciudad y marca también los pueblos de alrededor donde sueles comprar. Lo que pagues fuera de esta zona contará como viaje.</p>
    <label class="field"><span>Tu ciudad</span><input id="f-city" type="text" placeholder="Salamanca" value="${esc(city)}" /></label>
    ${stats.length ? `<h3>Lugares donde has pagado</h3>
    ${stats.map((s) => `<label class="check"><input type="checkbox" data-home="${esc(s.key)}" ${checked.has(s.key) ? 'checked' : ''} />
      <span class="row-main"><b>${esc(placeLabel(s))}</b><small>${s.n} ${s.n === 1 ? 'pago' : 'pagos'} · ${s.days} ${s.days === 1 ? 'día' : 'días'}</small></span><span class="amt">${eur(s.total)}</span></label>`).join('')}` : ''}
    <label class="field"><span>Otros pueblos de tu zona (separados por comas)</span><input id="f-extra" type="text" placeholder="Villamayor, Santa Marta de Tormes" value="${esc(extra.join(', '))}" /></label>
    <div class="actions"><button class="btn" data-act="home-save">Guardar mi zona</button></div>`);
}

function tripForm(t, title) {
  state.draft = { ...t };
  openSheet(`<h2>${title}</h2>
    <label class="field"><span>Nombre</span><input id="f-tname" type="text" placeholder="Asturias, Oporto…" value="${esc(t.name || '')}" /></label>
    <div class="grid2"><label class="field"><span>Desde</span><input id="f-tfrom" type="date" value="${t.from || ''}" /></label>
    <label class="field"><span>Hasta</span><input id="f-tto" type="date" value="${t.to || ''}" /></label></div>
    <p class="hint">Cuentan los pagos de esos días hechos fuera de tu zona, y también los Bizum, el efectivo y los avisos del banco, que no traen lugar. No cuentan las compras por internet ni las facturas de casa.</p>
    <div class="actions"><button class="btn" data-act="trip-save">Guardar viaje</button></div>`);
}

function tripSheet(t) {
  const s = tripSummary(db, t);
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const places = Object.entries(s.byPlace).sort((a, b) => b[1] - a[1]);
  openSheet(`<h2>🧳 ${esc(t.name)}</h2><p class="hint">Del ${short(t.from)} al ${short(t.to)} · ${s.days} ${s.days === 1 ? 'día' : 'días'}</p>
    <div class="big center">${eur(s.total)}</div><p class="hint center">${s.movs.length} ${s.movs.length === 1 ? 'pago' : 'pagos'}${s.days > 1 ? ' · ' + eur(s.total / s.days) + ' al día' : ''}</p>
    ${cats.length ? `<h3>Por categoría</h3>${cats.map(([k, v]) => ln(`${CATS[k].icon} ${CATS[k].name}`, eur(v))).join('')}` : ''}
    ${places.length > 1 ? `<h3>Por lugar</h3>${places.map(([k, v]) => ln('📍 ' + esc(k), eur(v))).join('')}` : ''}
    ${s.movs.length ? `<h3>Pagos</h3><div class="card flush inset">${s.movs.map(movRow).join('')}</div>` : '<p class="hint">Aún no hay pagos en esas fechas.</p>'}
    <div class="actions"><button class="btn ghost" data-act="trip-edit" data-id="${t.id}">Editar</button><button class="btn danger" data-act="trip-del" data-id="${t.id}">Eliminar</button></div>`);
}

// ---------- gastos por categoría ----------
function spendPeriods() {
  const per = periods().filter((p) => p.movs.length);
  const all = { label: 'Todo', movs: db.movements, from: db.movements[db.movements.length - 1]?.date };
  return [...per.map((p) => ({ label: periodLabel(p), movs: p.movs, from: p.from, to: p.to })), all];
}
function catTotals(movs) {
  const t = {};
  for (const m of movs) if (m.amount < 0 && m.cat !== 'ahorro') { const c = (t[m.cat] ||= { total: 0, n: 0, movs: [] }); c.total -= m.amount; c.n++; c.movs.push(m); }
  return t;
}
function spending() {
  const head = `<header class="top"><h1>Gastos</h1></header>`;
  if (!db.movements.length) return head + emptyState('Aún no hay gastos', 'Importa el extracto en PDF de tu banco para ver en qué se va tu dinero.');
  const per = spendPeriods();
  const i = Math.min(state.spPeriod || 0, per.length - 1);
  const cur = catTotals(per[i].movs);
  const prev = per[i + 1] && per[i + 1].label !== 'Todo' ? catTotals(per[i + 1].movs) : null;
  const rows = Object.entries(cur).sort((a, b) => b[1].total - a[1].total);
  const total = rows.reduce((a, [, v]) => a + v.total, 0);
  const max = rows[0]?.[1].total || 1;
  const chips = per.map((p, k) => `<button class="chip ${k === i ? 'on' : ''}" data-act="sp-period" data-i="${k}">${p.label}</button>`).join('');
  const donut = rows.length ? (() => {
    let acc = 0;
    const stops = rows.map(([k, v]) => { const a = acc; acc += (v.total / total) * 100; return `${(CATS[k] || CATS.otros).color} ${a}% ${acc}%`; }).join(',');
    return `<div class="donut" style="background:conic-gradient(${stops})"><div><b>${eur0(total)}</b><small>${rows.length} categorías</small></div></div>`;
  })() : '';
  const list = rows.map(([k, v]) => {
    const c = CATS[k] || CATS.otros;
    const pct = Math.round((v.total / total) * 100);
    const d = prev ? v.total - (prev[k]?.total || 0) : null;
    const diff = d == null || Math.abs(d) < 1 ? '' : ` · <span class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '▲' : '▼'} ${eur0(Math.abs(d))}</span>`;
    return `<button class="row" data-act="sp-cat" data-cat="${k}">
      <span class="bubble" style="--c:${c.color}">${c.icon}</span>
      <span class="cat-main"><span class="cat-top"><b>${c.name}</b><span>${eur(v.total)}</span></span>
      <span class="bar thin"><i style="${barStyle(k, v.total, max, c.color)}"></i></span>
      <small class="muted">${pct} % · ${v.n} ${v.n === 1 ? 'pago' : 'pagos'}${db.budgets[k] ? ` · ${budTxt(k)}` : ''}${diff}</small></span><span class="chev">›</span></button>`;
  }).join('');
  return head + `<div class="chips scroll">${chips}</div>` +
    (rows.length ? `<section class="card">${donut}</section><section class="card flush">${list}</section>
      ${prev ? '<p class="hint">▲▼ comparado con el periodo anterior.</p>' : ''}
      <button class="btn ghost wide" data-act="budgets">${Object.keys(db.budgets).length ? 'Cambiar topes de gasto' : 'Poner topes de gasto'}</button>`
      : '<section class="card"><p class="hint">Sin gastos en este periodo.</p></section>');
}
function catDetail(cat) {
  const per = spendPeriods();
  const p = per[Math.min(state.spPeriod || 0, per.length - 1)];
  const v = catTotals(p.movs)[cat];
  if (!v) return;
  const c = CATS[cat] || CATS.otros;
  const shops = Object.entries(v.movs.reduce((a, m) => { (a[m.title] ||= { total: 0, n: 0 }); a[m.title].total -= m.amount; a[m.title].n++; return a; }, {})).sort((a, b) => b[1].total - a[1].total);
  const b = db.budgets[cat];
  const u = budgetUse(cat);
  openSheet(`<h2>${c.icon} ${c.name}</h2><p class="hint">${p.label}</p>
    <div class="big center">${eur(v.total)}</div><p class="hint center">${v.n} ${v.n === 1 ? 'pago' : 'pagos'} · media ${eur(v.total / v.n)}${b ? (u.monthly ? ` · este mes ${eur(u.spent)} de ${eur0(b)} (${Math.round(u.r * 100)} %)` : ` · ${Math.round((v.total / b) * 100)} % del tope de ${eur0(b)}`) : ''}</p>
    ${b ? `<div class="bar"><i style="${barStyle(cat, v.total, b, c.color)}"></i></div>` : ''}
    <h3>Dónde</h3>${shops.map(([k, s]) => ln(`${esc(k)}${s.n > 1 ? ` <small class="muted">× ${s.n}</small>` : ''}`, eur(s.total))).join('')}
    <h3>Pagos</h3><div class="card flush inset">${v.movs.map((m) => movRow(m).replace('<small>', `<small>${short(m.date)} · `)).join('')}</div>
    <div class="actions"><button class="btn ghost" data-act="cat-filter" data-cat="${cat}">Ver en Movimientos</button></div>`);
}

// Desglose de un lugar: en qué comercios y categorías se fue el dinero.
function placeSheet(key) {
  const s = placeStats(db).find((x) => x.key === key);
  if (!s) return;
  const movs = db.movements.filter((m) => { const p = placeOf(m); return p && !p.online && p.key === key; });
  const group = (f) => Object.entries(movs.reduce((a, m) => { const k = f(m); a[k] = a[k] || { total: 0, n: 0 }; a[k].total -= m.amount; a[k].n++; return a; }, {})).sort((a, b) => b[1].total - a[1].total);
  const shops = group((m) => m.title);
  const cats = group((m) => m.cat);
  const first = movs[movs.length - 1].date, last = movs[0].date;
  openSheet(`<h2>${s.home ? '🏠' : '📍'} ${esc(placeLabel(s))}</h2>
    <p class="hint">${s.home ? 'Tu zona · ' : ''}${first === last ? long(first) : `Del ${short(first)} al ${short(last)}`}</p>
    <div class="big center">${eur(s.total)}</div><p class="hint center">${s.n} ${s.n === 1 ? 'pago' : 'pagos'} en ${s.days} ${s.days === 1 ? 'día' : 'días'} · media ${eur(s.total / s.n)}</p>
    <h3>Dónde</h3>${shops.map(([k, v]) => ln(`${esc(k)}${v.n > 1 ? ` <small class="muted">× ${v.n}</small>` : ''}`, eur(v.total))).join('')}
    ${cats.length > 1 ? `<h3>En qué</h3>${cats.map(([k, v]) => ln(`${CATS[k].icon} ${CATS[k].name}`, eur(v.total))).join('')}` : ''}
    <h3>Pagos</h3><div class="card flush inset">${movs.map((m) => movRow(m).replace('<small>', `<small>${short(m.date)} · `)).join('')}</div>
    <div class="actions"><button class="btn ghost" data-act="place-zone" data-key="${esc(key)}">${s.home ? 'Quitar de mi zona' : 'Es de mi zona'}</button></div>`);
}

function trips() {
  const head = `<header class="top"><h1>Viajes</h1><button class="btn small" data-act="trip-new">＋ Viaje</button></header>`;
  if (!db.settings.home?.length) return head + askHomeCard();
  const stats = placeStats(db);
  const zoneNames = db.settings.home.map((k) => stats.find((s) => s.key === k)?.name || k.replace(/(^|\s)\S/g, (c) => c.toUpperCase()));
  const zone = `<section class="card"><div class="card-head"><h2>🏠 Tu zona</h2><button class="link" data-act="home-ask">Cambiar</button></div><p class="hint">${esc(zoneNames.join(', '))}</p></section>`;
  state.proposals = detectTrips(db);
  const props = state.proposals.map((t, i) => {
    const total = t.places.reduce((a, p) => a + p.total, 0);
    return `<section class="card propose"><div class="card-head"><h2>¿Fue un viaje?</h2><span class="tag">${range(t.from, t.to)}</span></div>
      <p>📍 <b>${esc(t.places.map(placeLabel).join(', '))}</b> · ${eur(total)}</p>
      <div class="actions wrap"><button class="btn small" data-act="trip-accept" data-i="${i}">Sí, guardar</button><button class="btn small ghost" data-act="trip-home" data-i="${i}">Es de mi zona</button><button class="btn small ghost" data-act="trip-skip" data-i="${i}">No</button></div></section>`;
  }).join('');
  const saved = (db.trips || []).slice().sort((a, b) => (a.from < b.from ? 1 : -1)).map((t) => {
    const s = tripSummary(db, t);
    return `<button class="pay" data-act="trip" data-id="${t.id}"><span class="pay-top"><span><small>${range(t.from, t.to)} · ${s.days} ${s.days === 1 ? 'día' : 'días'}</small><b>${eur(s.total)}</b></span><span class="bubble" style="--c:#4f8fd9">🧳</span></span>
      <span class="pay-sub">${esc(t.name)} · ${s.movs.length} ${s.movs.length === 1 ? 'pago' : 'pagos'}</span></button>`;
  }).join('');
  const empty = !props && !saved ? `<section class="card"><p class="hint">Cuando pagues con tarjeta fuera de tu zona, te propondré guardarlo como viaje. También puedes crear uno a mano con sus fechas.</p></section>` : '';
  const places = stats.length ? `<h3 class="day">Gasto por lugar</h3><section class="card flush">${stats.map((s) => `<button class="row" data-act="place" data-key="${esc(s.key)}">
      <span class="bubble" style="--c:${s.home ? '#1f9d6b' : '#4f8fd9'}">${s.home ? '🏠' : '📍'}</span>
      <span class="row-main"><b>${esc(placeLabel(s))}</b><small>${s.home ? 'Tu zona · ' : ''}${s.n} ${s.n === 1 ? 'pago' : 'pagos'}</small></span><span class="amt">${eur(s.total)}</span><span class="chev">›</span></button>`).join('')}</section>
    <p class="hint">Las compras por internet no cuentan: el banco pone la sede de la tienda, no dónde estabas. Los avisos del banco tampoco traen lugar; aparece al importar el extracto.</p>` : '';
  return head + zone + props + (saved ? `<h3 class="day">Tus viajes</h3>${saved}` : '') + empty + places;
}

// ---------- apunte rápido ----------
function addSheet(d) {
  state.draft = d;
  const cats = Object.entries(CATS).filter(([k, v]) => (d.kind === 'in' ? v.income && k !== 'nomina' : !v.income));
  if (!cats.some(([k]) => k === d.cat)) d.cat = d.kind === 'in' ? 'ingreso' : 'otros';
  // Conceptos que ya has apuntado a mano: un toque rellena el apunte.
  const seen = new Set();
  state.sugs = d.id ? [] : db.movements.filter((m) => m.manual && (d.kind === 'in') === m.amount > 0 && !seen.has(plain(m.title)) && seen.add(plain(m.title))).slice(0, 6);
  const sugs = state.sugs.length && !d.title ? `<div class="chips scroll sugs">${state.sugs.map((m, i) => `<button class="chip" data-act="add-sug" data-i="${i}">${(CATS[m.cat] || CATS.otros).icon} ${esc(m.title)} · ${eur(Math.abs(m.amount)).replace(',00', '')}</button>`).join('')}</div>` : '';
  openSheet(`<h2>${d.id ? 'Editar apunte' : 'Apunte rápido'}</h2>${d.id ? '' : '<p class="hint">Para el efectivo y lo que no sale en el extracto. Los pagos con tarjeta ya llegan al importar el PDF.</p>'}${sugs}
    <div class="seg"><button class="${d.kind === 'out' ? 'on' : ''}" data-act="add-kind" data-k="out">Gasto</button><button class="${d.kind === 'in' ? 'on' : ''}" data-act="add-kind" data-k="in">Ingreso</button></div>
    <label class="field"><span>Importe (€)</span><input id="f-amount" type="text" inputmode="decimal" placeholder="0,00" value="${esc(d.amount || '')}" /></label>
    <label class="field"><span>Concepto</span><input id="f-title" type="text" placeholder="${d.kind === 'in' ? 'Me devolvieron…' : 'Café, mercado, propina…'}" value="${esc(d.title || '')}" /></label>
    <label class="field"><span>Fecha</span><input id="f-date" type="date" value="${d.date}" max="${todayIso()}" /></label>
    <div class="catgrid">${cats.map(([k, v]) => `<button class="catopt ${k === d.cat ? 'on' : ''}" data-act="add-cat" data-cat="${k}"><span>${v.icon}</span>${v.name}</button>`).join('')}</div>
    <div class="actions"><button class="btn" data-act="add-save">Guardar</button></div>`);
}
const addDraft = () => Object.assign(state.draft, { amount: $('#f-amount').value, title: $('#f-title').value, date: $('#f-date').value });

// ---------- recordatorios ----------
async function scheduleReminders(ask) {
  if (!db.settings.remind || !Capacitor.isNativePlatform()) return !!db.settings.remind;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted' && ask) p = await LocalNotifications.requestPermissions();
    if (p.display !== 'granted') return false;
    await LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }] });
    const at = (iso, plus) => { const d = toDate(iso); d.setDate(d.getDate() + plus); d.setHours(10, 0, 0, 0); return d; };
    const now = new Date();
    let a = at(db.settings.lastImport || todayIso(), 15);
    if (a <= now) a = at(todayIso(), 1);
    const list = [{ id: 1, title: 'Toca actualizar Mi Hucha', body: 'Descarga el extracto del banco y compártelo con la app para no perder movimientos.', schedule: { at: a, allowWhileIdle: true } }];
    const np = nextPayday();
    if (np && at(np, 1) > now) list.push({ id: 2, title: '¿Ya has cobrado?', body: 'Importa el extracto y la nómina de este mes para ver cuánto puedes ahorrar.', schedule: { at: at(np, 1), allowWhileIdle: true } });
    await LocalNotifications.schedule({ notifications: list });
    return true;
  } catch (e) { console.error(e); return false; }
}

// ---------- PDF compartido desde otra app ----------
async function takeShared(ShareIn) {
  const { data } = await ShareIn.take();
  if (!data) return;
  if (!sheet.hidden) closeSheet();
  await importPdf(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
}
if (Capacitor.isNativePlatform()) {
  const ShareIn = registerPlugin('ShareIn');
  ShareIn.addListener('shared', () => takeShared(ShareIn));
  takeShared(ShareIn).catch(console.error);
}

// ---------- render y eventos ----------
const VIEWS = { home, movs, spending, payroll, savings, trips };
// Avisa una vez al cruzar el 80 % y otra al pasar el 100 % de cada tope (por mes o por nómina).
function checkBudgets() {
  const st = db.settings.budgetAlerts || {};
  let changed = false;
  Object.keys(db.budgets).forEach((k, i) => {
    const u = budgetUse(k);
    if (!u) return;
    const level = u.r >= 1 ? 2 : u.r >= 0.8 ? 1 : 0;
    const prev = st[k]?.key === u.key ? st[k].level : 0;
    if (st[k]?.key !== u.key || st[k].level !== level) { st[k] = { key: u.key, level }; changed = true; }
    if (level > prev) notifyBudget(k, u, level, i);
  });
  if (changed) { db.settings.budgetAlerts = st; save(); }
}
async function notifyBudget(k, u, level, i) {
  const c = CATS[k] || CATS.otros;
  const when = u.monthly ? 'este mes' : 'desde la última nómina';
  const msg = level === 2
    ? `Te has pasado del tope de ${c.name}: ${eur(u.spent)} de ${eur0(u.b)} ${when}.`
    : `Llevas el ${Math.round(u.r * 100)} % del tope de ${c.name}: ${eur(u.spent)} de ${eur0(u.b)} ${when}.`;
  toast(`${c.icon} ${msg}`);
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    await LocalNotifications.schedule({ notifications: [{ id: 2000 + i * 3 + level, title: `${c.icon} Tope de ${c.name}`, body: msg }] });
  } catch (e) { console.error(e); }
}

// ---------- personalizar barra e Inicio ----------
const sw = (act, k, on, locked) => `<label class="switch${locked ? ' locked' : ''}"><input type="checkbox" data-act="${act}" data-k="${k}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="Mostrar" /><i></i></label>`;
function layoutSheet() {
  const tabs = tabLayout(db.settings);
  const cards = homeLayout(db.settings);
  const hiddenN = tabs.filter((t) => !t.on).length;
  const keepScroll = sheet.querySelector('.panel')?.scrollTop;
  openSheet(`<div class="lay-head"><h2>Personalizar</h2><button class="link" data-act="lay-reset">Restablecer</button></div>
    <p class="hint">Mantén pulsado <span class="grip-inline">${GRIP}</span> y arrastra para cambiar el orden. El interruptor muestra u oculta.</p>
    <h3>Barra inferior</h3>
    <div class="tab-preview" aria-hidden="true">${tabButtons(state.tab, tabs)}</div>
    <div class="dnd" data-list="tabs">${tabs.map((t) => `<div class="dnd-item ${t.on ? '' : 'off'}" data-k="${t.k}">
      <span class="dnd-handle" aria-label="Mover ${TAB_DEFS[t.k]}">${GRIP}</span>
      <span class="dnd-ico"><svg viewBox="0 0 24 24">${ICONS[t.k]}</svg></span>
      <span class="row-main"><b>${TAB_DEFS[t.k]}</b><small>${t.k === 'home' ? 'Siempre visible' : t.on ? 'En la barra' : 'En «Más»'}</small></span>
      ${sw('lay-tab', t.k, t.on, t.k === 'home')}</div>`).join('')}</div>
    <p class="hint" id="lay-more">${hiddenN ? `Las pestañas ocultas siguen a mano en el botón «Más».` : 'Si ocultas alguna, aparecerá un botón «Más» para llegar a ella.'}</p>
    <h3>Pantalla de Inicio</h3>
    <div class="dnd" data-list="home">${cards.map((c) => { const [ico, name, desc] = HOME_DEFS[c.k]; return `<div class="dnd-item ${c.on ? '' : 'off'}" data-k="${c.k}">
      <span class="dnd-handle" aria-label="Mover ${name}">${GRIP}</span>
      <span class="dnd-ico emoji-ico">${ico}</span>
      <span class="row-main"><b>${name}</b><small>${desc}</small></span>
      ${sw('lay-card', c.k, c.on)}</div>`; }).join('')}</div>
    <p class="hint">El saldo va siempre arriba. Los avisos (topes, versión nueva, copia) aparecen solo cuando hacen falta.</p>
    <div class="actions"><button class="btn" data-act="close">Listo</button></div>`);
  if (keepScroll) sheet.querySelector('.panel').scrollTop = keepScroll;
}
function saveLayout(kind, list, rebuild = true) {
  db.settings[kind] = list.map(({ k, on }) => ({ k, on }));
  save(); render();
  if (rebuild) return layoutSheet();
  // Solo cambia la visibilidad: se actualiza en el sitio para que el interruptor se anime.
  const tabs = tabLayout(db.settings);
  sheet.querySelector('.tab-preview').innerHTML = tabButtons(state.tab, tabs);
  sheet.querySelector('#lay-more').textContent = tabs.some((t) => !t.on) ? 'Las pestañas ocultas siguen a mano en el botón «Más».' : 'Si ocultas alguna, aparecerá un botón «Más» para llegar a ella.';
  for (const it of list) {
    const el = sheet.querySelector(`.dnd[data-list="${kind === 'tabs' ? 'tabs' : 'home'}"] .dnd-item[data-k="${it.k}"]`);
    el.classList.toggle('off', !it.on);
    if (kind === 'tabs' && it.k !== 'home') el.querySelector('small').textContent = it.on ? 'En la barra' : 'En «Más»';
  }
}
enableDrag((kind, from, to) => {
  const list = kind === 'tabs' ? tabLayout(db.settings) : homeLayout(db.settings);
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x);
  saveLayout(kind === 'tabs' ? 'tabs' : 'homeCards', list);
});
// Mantener pulsada la barra inferior abre el editor.
let pressT = 0, pressed = false;
$('#tabs').addEventListener('pointerdown', () => { pressed = false; clearTimeout(pressT); pressT = setTimeout(() => { pressed = true; try { navigator.vibrate?.(15); } catch {} layoutSheet(); }, 600); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $('#tabs').addEventListener(ev, () => clearTimeout(pressT)));
$('#tabs').addEventListener('click', (e) => { if (pressed) { e.stopPropagation(); e.preventDefault(); pressed = false; } }, true);

// ---------- novedades ----------
const fmtDay = (iso) => { const d = toDate(iso); return `${d.getDate()} de ${MES_L[d.getMonth()]}`; };
function newsSheet() {
  const [cur, ...old] = CHANGELOG;
  const item = ([ico, t, d]) => `<div class="news-item"><span class="news-ico">${ico}</span><span class="row-main"><b>${t}</b><small>${d}</small></span></div>`;
  openSheet(`<div class="news-head"><span class="tag">Versión ${cur.v}</span>${cur.date ? `<small>${fmtDay(cur.date)}` + '</small>' : ''}</div>
    <h2>Novedades</h2>
    <div class="news-list">${cur.items.map(item).join('')}</div>
    <details class="news-old"><summary>Versiones anteriores</summary>
      ${old.map((r) => `<h3>Versión ${r.v}</h3><div class="news-list">${r.items.map(item).join('')}</div>`).join('')}
    </details>
    <div class="actions"><button class="btn" data-act="close">Entendido</button></div>`);
}
// La primera vez que se abre una versión nueva (y solo si ya usabas la app) enseña sus novedades.
function maybeShowNews() {
  if (db.settings.seenVersion === __APP_VERSION__ || !lockEl.hidden) return;
  const had = db.movements.length || db.payslips.length || db.goals.length;
  db.settings.seenVersion = __APP_VERSION__;
  save();
  if (had && sheet.hidden) newsSheet();
}

// Tema (automático, claro u oscuro) e importes ocultos.
function applyLook() {
  const t = db.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  document.body.classList.toggle('hide-money', !!db.settings.hideMoney);
}
function render() {
  app.innerHTML = VIEWS[state.tab]();
  setTimeout(checkBudgets, 0);
  $('#tabs').innerHTML = tabButtons(state.tab);
}

const ACTIONS = {
  close: () => closeSheet(),
  tab: (el) => { state.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  period: (el) => { state.period = +el.dataset.i; render(); },
  filter: (el) => { state.filter = el.dataset.f; render(); },
  'cat-filter': (el) => {
    if (!sheet.hidden) closeSheet(); state.filter = el.dataset.cat; state.query = ''; state.tab = 'movs'; render(); window.scrollTo(0, 0); },
  import: () => $('#file-pdf').click(),
  'geo-toggle': async (el) => {
    const on = el.checked;
    await Noti.geoSet({ on }).catch(() => {});
    native.geo = on ? await Noti.geoRequest().catch(() => ({})) : await Noti.geoStatus().catch(() => ({}));
    settingsSheet();
  },
  'geo-perm': async () => { native.geo = await Noti.geoRequest().catch(() => ({})); settingsSheet(); },
  'geo-bg': async () => {
    native.geo = await Noti.geoRequestBackground().catch(() => native.geo || {});
    // Android reciente no muestra diálogo para «todo el tiempo»: hay que elegirlo en los ajustes de la app.
    if (!native.geo.background) { await Noti.openAppSettings().catch(() => {}); toast('Entra en Permisos → Ubicación → «Permitir todo el tiempo».'); }
    settingsSheet();
  },
  'app-settings': () => Noti.openAppSettings().catch(() => {}),
  'kw-add': () => {
    const w = $('#f-kw').value.trim(), cat = $('#f-kwcat').value;
    if (w.length < 3) return toast('Escribe al menos 3 letras.');
    const kw = (db.catKeywords ||= {});
    for (const k of Object.keys(kw)) { kw[k] = kw[k].filter((x) => x.toLowerCase() !== w.toLowerCase()); if (!kw[k].length) delete kw[k]; }
    (kw[cat] ||= []).push(w);
    setKeywords(kw);
    let n = 0;
    for (const m of db.movements) if (m.amount < 0 && m.cat !== cat && !m.catSet && !db.rules[m.title.toLowerCase()] && kwMatch(m, w)) { m.cat = cat; n++; }
    save(); render(); settingsSheet();
    toast(n ? `Palabra añadida. ${n} ${n === 1 ? 'gasto pasa' : 'gastos pasan'} a ${CATS[cat].name}.` : 'Palabra añadida.');
  },
  'kw-del': (el) => {
    const kw = db.catKeywords || {};
    kw[el.dataset.cat] = (kw[el.dataset.cat] || []).filter((x) => x !== el.dataset.w);
    if (!kw[el.dataset.cat].length) delete kw[el.dataset.cat];
    setKeywords(kw); save(); settingsSheet();
    toast('Palabra quitada. Los gastos ya clasificados no cambian.');
  },
  'home-ask': homeSheet,
  'sp-period': (el) => { state.spPeriod = +el.dataset.i; render(); },
  'sp-cat': (el) => catDetail(el.dataset.cat),
  place: (el) => placeSheet(el.dataset.key),
  'place-zone': (el) => {
    const k = el.dataset.key;
    const home = new Set(db.settings.home || []);
    const was = home.has(k);
    if (was) home.delete(k); else home.add(k);
    db.settings.home = [...home];
    save(); closeSheet(); render();
    toast(was ? 'Quitado de tu zona.' : 'Añadido a tu zona.');
  },
  'home-save': () => {
    const city = $('#f-city').value.trim();
    const keys = new Set([...sheet.querySelectorAll('[data-home]')].filter((i) => i.checked).map((i) => i.dataset.home));
    if (city) keys.add(norm(city));
    $('#f-extra').value.split(',').map(norm).filter(Boolean).forEach((k) => keys.add(k));
    if (!keys.size) return toast('Escribe tu ciudad o marca algún lugar.');
    db.settings.home = [...keys];
    db.settings.city = city;
    save(); closeSheet(); render();
    const n = detectTrips(db).length;
    toast(n ? `Zona guardada. He encontrado ${n} ${n === 1 ? 'posible viaje' : 'posibles viajes'}.` : 'Zona guardada.');
  },
  'trip-new': () => tripForm({ from: todayIso(), to: todayIso() }, 'Nuevo viaje'),
  'trip-accept': (el) => { const t = state.proposals[+el.dataset.i]; tripForm({ name: tripName(t), from: t.from, to: t.to }, 'Guardar viaje'); },
  'trip-home': (el) => {
    const t = state.proposals[+el.dataset.i];
    db.settings.home = [...new Set([...db.settings.home, ...t.places.map((p) => p.key)])];
    save(); render();
    toast(`${t.places.map((p) => p.name).join(', ')} ${t.places.length === 1 ? 'añadido' : 'añadidos'} a tu zona.`);
  },
  'trip-skip': (el) => {
    db.settings.tripsSkipped = [...(db.settings.tripsSkipped || []), state.proposals[+el.dataset.i].id];
    save(); render();
  },
  trip: (el) => tripSheet(db.trips.find((t) => t.id === el.dataset.id)),
  'trip-edit': (el) => tripForm(db.trips.find((t) => t.id === el.dataset.id), 'Editar viaje'),
  'trip-save': () => {
    const name = $('#f-tname').value.trim(), from = $('#f-tfrom').value, to = $('#f-tto').value;
    if (!name) return toast('Ponle un nombre al viaje.');
    if (!from || !to || to < from) return toast('Revisa las fechas.');
    const d = state.draft;
    db.trips = db.trips || [];
    if (d.id) Object.assign(db.trips.find((t) => t.id === d.id), { name, from, to });
    else db.trips.push({ id: uid(), name, from, to });
    save(); closeSheet(); state.tab = 'trips'; render();
    toast('Viaje guardado: ' + eur(tripSummary(db, { from, to }).total) + '.');
  },
  'trip-del': (el) => { const id = el.dataset.id; closeSheet(); withUndo('Viaje eliminado. Los pagos no se borran.', () => { db.trips = db.trips.filter((t) => t.id !== id); }); },
  budgets: budgetSheet,
  'budget-save': () => {
    const next = {};
    sheet.querySelectorAll('[data-bud]').forEach((i) => { const n = parseNum(i.value); if (n > 0) next[i.dataset.bud] = n; });
    db.budgets = next;
    const monthly = {};
    sheet.querySelectorAll('[data-budp]').forEach((s) => { if (s.value === 'm' && next[s.dataset.budp]) monthly[s.dataset.budp] = true; });
    db.settings.budgetMonthly = monthly;
    save(); closeSheet(); render();
    toast('Topes guardados.');
  },
  tax: taxSheet,
  'tax-save': () => {
    db.settings.tax = { otherGross: parseNum($('#f-ogross').value) || 0, otherRet: parseNum($('#f-oret').value) || 0 };
    save(); render(); taxSheet();
  },
  key: async (el) => {
    const k = el.dataset.k;
    if (k === 'del') pinBuf = pinBuf.slice(0, -1);
    else if (pinBuf.length < 4) pinBuf += k;
    drawLock();
    if (pinBuf.length < 4) return;
    const ok = (await sha(db.settings.lock.salt, pinBuf)) === db.settings.lock.hash;
    pinBuf = '';
    if (ok) unlock(); else drawLock('PIN incorrecto. Prueba otra vez.');
  },
  bio: tryBio,
  'lock-on': async () => {
    const a = $('#f-pin').value, b = $('#f-pin2').value;
    if (!/^\d{4}$/.test(a)) return toast('El PIN debe tener 4 cifras.');
    if (a !== b) return toast('Los dos PIN no coinciden.');
    const salt = uid() + uid();
    db.settings.lock = { salt, hash: await sha(salt, a), bio: true };
    save(); closeSheet();
    toast(native.bio ? 'Bloqueo activado con PIN y huella.' : 'Bloqueo activado con PIN.');
  },
  'lock-off': async () => {
    const l = db.settings.lock;
    if ((await sha(l.salt, $('#f-pin-old').value)) !== l.hash) return toast('Ese no es el PIN actual.');
    delete db.settings.lock;
    save(); closeSheet();
    toast('Bloqueo quitado.');
  },
  'noti-perm': () => Noti?.openSettings().catch(() => toast('No se pudieron abrir los ajustes de Android.')),
  add: () => addSheet({ kind: 'out', cat: 'otros', date: todayIso() }),
  'add-kind': (el) => addSheet({ ...addDraft(), kind: el.dataset.k }),
  'add-cat': (el) => { state.draft.cat = el.dataset.cat; sheet.querySelectorAll('.catopt').forEach((b) => b.classList.toggle('on', b === el)); },
  'add-save': () => {
    const d = addDraft();
    const n = parseNum(d.amount);
    if (!n || n <= 0) return toast('Escribe el importe.');
    if (!d.date) return toast('Elige la fecha.');
    const mov = { date: d.date, title: d.title.trim() || CATS[d.cat].name, amount: d.kind === 'in' ? n : -n, cat: d.cat };
    if (d.id) editMov(d.id, mov); else addManual(mov);
    save(); closeSheet(); render();
    toast(d.id ? 'Apunte actualizado.' : 'Apunte guardado.');
  },
  'mov-del': (el) => { const id = el.dataset.id; closeSheet(); withUndo('Apunte eliminado.', () => { db.movements = db.movements.filter((m) => m.id !== id); }); },
  'mov-edit': (el) => {
    const m = db.movements.find((x) => x.id === el.dataset.id);
    addSheet({ id: m.id, kind: m.amount > 0 ? 'in' : 'out', cat: m.cat, date: m.date, title: m.title, amount: String(Math.abs(m.amount)).replace('.', ',') });
  },
  'add-sug': (el) => { const m = state.sugs[+el.dataset.i]; addSheet({ ...addDraft(), title: m.title, cat: m.cat, amount: $('#f-amount').value || String(Math.abs(m.amount)).replace('.', ',') }); },
  amt: (el) => { $('#f-amount').value = String(el.dataset.v).replace('.', ','); },
  undo: () => { const f = undoFn; undoFn = null; $('#toast').hidden = true; f?.(); },
  'hide-money': () => { db.settings.hideMoney = !db.settings.hideMoney; save(); applyLook(); render(); if (!sheet.hidden) settingsSheet(); },
  theme: (el) => { db.settings.theme = el.dataset.t; save(); applyLook(); settingsSheet(); },
  'upd-auto': (el) => { db.settings.updAuto = el.checked; save(); },
  'backup-later': () => { db.settings.backupSnooze = todayIso(); save(); render(); },
  'exit-ask': (el) => { db.settings.exitNoAsk = !el.checked; save(); },
  'exit-yes': async () => {
    if ($('#f-noask')?.checked) { db.settings.exitNoAsk = true; save(); }
    closeSheet();
    const { App } = await import('@capacitor/app');
    App.exitApp();
  },
  remind: async (el) => {
    db.settings.remind = el.dataset.on === '1';
    save();
    if (db.settings.remind && !(await scheduleReminders(true))) { db.settings.remind = false; save(); toast('Android no ha dado permiso para las notificaciones.'); }
    else if (db.settings.remind) toast(Capacitor.isNativePlatform() ? 'Avisos activados.' : 'Avisos activados: funcionan en la app del móvil.');
    else if (Capacitor.isNativePlatform()) { const { LocalNotifications } = await import('@capacitor/local-notifications'); await LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(() => {}); }
    if (!sheet.hidden) closeSheet();
    render();
  },
  settings: settingsSheet,
  layout: layoutSheet,
  'lay-tab': (el) => { const l = tabLayout(db.settings); l.find((t) => t.k === el.dataset.k).on = el.checked; saveLayout('tabs', l, false); },
  'lay-card': (el) => { const l = homeLayout(db.settings); l.find((c) => c.k === el.dataset.k).on = el.checked; saveLayout('homeCards', l, false); },
  'lay-reset': () => { delete db.settings.tabs; delete db.settings.homeCards; save(); render(); layoutSheet(); toast('Diseño original restablecido.'); },
  more: () => {
    const hidden = tabLayout(db.settings).filter((t) => !t.on);
    openSheet(`<h2>Más</h2><section class="card flush">${hidden.map((t) => `<button class="row" data-act="more-go" data-tab="${t.k}"><span class="dnd-ico"><svg viewBox="0 0 24 24">${ICONS[t.k]}</svg></span><span class="row-main"><b>${TAB_DEFS[t.k]}</b></span><span class="chev">›</span></button>`).join('')}</section>
      <button class="btn ghost wide" data-act="layout">Personalizar barra e Inicio</button>`);
  },
  'more-go': (el) => { closeSheet(); state.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  news: newsSheet,
  mov: (el) => movSheet(db.movements.find((m) => m.id === el.dataset.id)),
  setcat: (el) => {
    const id = el.dataset.id, cat = el.dataset.cat;
    const cur = db.movements.find((x) => x.id === id);
    if (cur.cat === cat) return closeSheet();
    const key = cur.title.toLowerCase();
    const n = cur.generic ? 1 : db.movements.filter((x) => x.title.toLowerCase() === key && x.amount > 0 === cur.amount > 0).length;
    closeSheet();
    withUndo(n > 1 ? `Categoría cambiada en ${n} movimientos.` : 'Categoría cambiada.', () => {
      const m = db.movements.find((x) => x.id === id);
      m.catSet = true;
      if (m.generic) { m.cat = cat; return; }
      for (const x of db.movements) if (x.title.toLowerCase() === key && x.amount > 0 === m.amount > 0) x.cat = cat;
      db.rules[key] = cat;
    });
  },
  slip: (el) => slipSheet(db.payslips.find((p) => p.id === el.dataset.id)),
  'slip-missing': (el) => {
    const m = db.movements.find((x) => x.id === el.dataset.id);
    openSheet(`<h2>Nómina del ${short(m.date)}</h2><p class="hint">Cobraste ${eur(m.amount)}, pero falta el desglose. Importa el PDF de esa nómina o escribe los datos a mano.</p>
      <div class="actions"><button class="btn" data-act="import">Importar PDF</button><button class="btn ghost" data-act="slip-new" data-net="${m.amount}">A mano</button></div>`);
  },
  'slip-new': (el) => slipForm({ company: db.payslips[0]?.company || '', net: el.dataset.net ? +el.dataset.net : null }, 'Añadir nómina'),
  'slip-edit': (el) => slipForm({ ...db.payslips.find((p) => p.id === el.dataset.id) }, 'Editar nómina'),
  'slip-save': saveSlip,
  'slip-del': (el) => { const id = el.dataset.id; closeSheet(); withUndo('Nómina eliminada.', () => { db.payslips = db.payslips.filter((p) => p.id !== id); }); },
  'goal-new': () => goalForm(),
  emoji: (el) => { state.draft.emoji = el.dataset.e; sheet.querySelectorAll('.emoji').forEach((b) => b.classList.toggle('on', b === el)); },
  'goal-save': () => {
    const name = $('#f-name').value.trim(), target = parseNum($('#f-target').value);
    if (!name || !target || target <= 0) return toast('Pon un nombre y una cantidad.');
    const d = state.draft;
    const due = $('#f-due').value || null;
    if (d.id) Object.assign(db.goals.find((g) => g.id === d.id), { name, target, emoji: d.emoji, due });
    else db.goals.push({ id: uid(), name, target, emoji: d.emoji, saved: 0, due });
    save(); closeSheet(); render();
  },
  goal: (el) => goalSheet(db.goals.find((g) => g.id === el.dataset.id)),
  'goal-edit': (el) => goalForm(db.goals.find((g) => g.id === el.dataset.id)),
  'goal-add': (el) => {
    const g = db.goals.find((x) => x.id === el.dataset.id);
    const n = parseNum($('#f-amount').value);
    if (!n || n <= 0) return toast('Escribe una cantidad.');
    const next = +(g.saved + n * +el.dataset.sign).toFixed(2);
    if (next < 0) return toast('No puedes retirar más de lo que hay.');
    g.saved = next;
    save(); closeSheet(); render();
    toast(+el.dataset.sign > 0 ? `${eur(n)} aportados a ${g.name}.` : `${eur(n)} retirados de ${g.name}.`);
  },
  'goal-del': (el) => { const id = el.dataset.id; closeSheet(); withUndo('Objetivo eliminado.', () => { db.goals = db.goals.filter((g) => g.id !== id); }); },
  'pct-save': () => {
    const n = parseNum($('#f-pct').value);
    if (n == null || n < 0 || n > 90) return toast('Pon un porcentaje entre 0 y 90.');
    db.settings.savePct = Math.round(n); save(); closeSheet(); render();
  },
  export: () => exportBackup().catch(() => toast('No se pudo exportar la copia.')),
  restore: () => $('#file-json').click(),
  update: (el) => checkUpdate(el),
  wipe: () => { if (!confirm('Se borrarán todos los movimientos, nóminas y objetivos de este móvil. ¿Continuar?')) return; resetDb(); closeSheet(); state.tab = 'home'; render(); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  ACTIONS[el.dataset.act]?.(el);
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  state.query = e.target.value;
  $('#mov-list').innerHTML = movList();
});
$('#file-pdf').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!sheet.hidden) closeSheet();
  await importPdf(file);
});
$('#file-json').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.movements) || !Array.isArray(data.payslips)) throw new Error('formato');
    if (!confirm('Se sustituirán los datos actuales por los de la copia. ¿Continuar?')) return;
    data.settings = { ...data.settings, lock: db.settings.lock };
    replaceDb(data); closeSheet(); render(); toast('Copia restaurada.');
  } catch { toast('Ese archivo no es una copia de Mi Hucha.'); }
});

save();
applyLook();
lockNow();
render();
maybeShowNews();
autoCheckUpdate();
scheduleReminders();
refreshNative().then(() => { if (!lockEl.hidden) drawLock(); tryBio(); takeNotis().catch(console.error); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (db.settings.lock && lockEl.hidden && hiddenAt && Date.now() - hiddenAt > 60000) { lockNow(); tryBio(); }
  if (hiddenAt && Date.now() - hiddenAt > 30 * 60e3) updShown = '';
  autoCheckUpdate();
  refreshNative().then(() => takeNotis()).catch(console.error);
});
setInterval(() => { if (!document.hidden) takeNotis().catch(() => {}); }, 5000);

// ---------- botón y gesto atrás (Android) ----------
if (Capacitor.isNativePlatform()) {
  import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => {
    if (!lockEl.hidden) return App.minimizeApp();
    if (!sheet.hidden) return closeSheet();
    if (state.tab !== 'home') { state.tab = 'home'; render(); window.scrollTo(0, 0); return; }
    if (db.settings.exitNoAsk) return App.exitApp();
    openSheet(`<h2>¿Salir de Mi Hucha?</h2>
      <label class="check"><input id="f-noask" type="checkbox" /><span class="row-main"><b>No volver a preguntar</b><small>Puedes cambiarlo en Ajustes</small></span></label>
      <div class="actions"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="exit-yes">Salir</button></div>`);
  }));
}
