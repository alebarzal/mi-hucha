// Orden y visibilidad de la barra inferior y de las tarjetas de Inicio, más el arrastre para reordenarlas.

export const TAB_DEFS = {
  home: 'Inicio',
  movs: 'Movimientos',
  spending: 'Gastos',
  payroll: 'Nóminas',
  savings: 'Ahorro',
  trips: 'Viajes',
};

export const HOME_DEFS = {
  now: ['💼', 'Desde tu última nómina', 'Cobrado, gastado y cuánto puedes gastar al día'],
  spend: ['📊', 'En qué se va el dinero', 'Gasto por categoría y topes'],
  last: ['🧾', 'Últimos movimientos', 'Los cinco más recientes'],
  goals: ['🎯', 'Tus objetivos', 'Cómo van tus objetivos de ahorro'],
};
const HOME_DEFAULT = [['now', true], ['spend', true], ['last', true], ['goals', false]];

// Lista guardada [{k, on}] completada con lo que falte (por si una versión nueva añade secciones).
function merged(saved, defs, defaults) {
  const out = (saved || []).filter((x) => defs[x.k]).map((x) => ({ k: x.k, on: x.on !== false }));
  for (const [k, on] of defaults) if (!out.some((x) => x.k === k)) out.push({ k, on });
  return out;
}
export const tabLayout = (s) => merged(s.tabs, TAB_DEFS, Object.keys(TAB_DEFS).map((k) => [k, true])).map((x) => (x.k === 'home' ? { ...x, on: true } : x));
export const homeLayout = (s) => merged(s.homeCards, HOME_DEFS, HOME_DEFAULT);

// ---------- arrastrar y soltar ----------
// Cualquier elemento .dnd-item dentro de un .dnd se mueve tirando de su .dnd-handle.
// Al soltar llama a onDrop(lista, de, a).
export function enableDrag(onDrop) {
  let d = null;
  const buzz = () => { try { navigator.vibrate?.(8); } catch { /* sin vibración */ } };

  const shiftOthers = () => {
    const step = d.rects[d.from].height + d.gap;
    d.items.forEach((el, i) => {
      if (i === d.from) return;
      let y = 0;
      if (d.from < d.to && i > d.from && i <= d.to) y = -step;
      if (d.from > d.to && i >= d.to && i < d.from) y = step;
      el.style.transform = y ? `translateY(${y}px)` : '';
    });
  };

  const move = (clientY) => {
    const dy = clientY - d.y0 + (d.scroller.scrollTop - d.scroll0);
    const first = d.rects[0], last = d.rects[d.rects.length - 1], me = d.rects[d.from];
    const min = first.top - me.top, max = last.bottom - me.bottom;
    const y = Math.max(min, Math.min(max, dy));
    d.item.style.transform = `translateY(${y}px) scale(1.03)`;
    const center = me.top + me.height / 2 + y;
    const to = d.rects.filter((r, i) => i !== d.from && r.top + r.height / 2 < center).length;
    if (to !== d.to) { d.to = to; shiftOthers(); buzz(); }
    d.y = y;
  };

  // Si se arrastra cerca del borde de la hoja, la desplaza.
  const autoScroll = () => {
    if (!d) return;
    const r = d.scroller.getBoundingClientRect();
    const edge = 70;
    let v = 0;
    if (d.clientY < r.top + edge) v = -Math.ceil((r.top + edge - d.clientY) / 6);
    else if (d.clientY > r.bottom - edge) v = Math.ceil((d.clientY - (r.bottom - edge)) / 6);
    if (v) { d.scroller.scrollTop += v; move(d.clientY); }
    d.raf = requestAnimationFrame(autoScroll);
  };

  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.dnd-handle');
    if (!h || d) return;
    const item = h.closest('.dnd-item');
    const list = item.parentElement;
    const items = [...list.querySelectorAll(':scope > .dnd-item')];
    const rects = items.map((el) => el.getBoundingClientRect());
    const from = items.indexOf(item);
    e.preventDefault();
    try { h.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    d = { item, list, items, rects, from, to: from, y0: e.clientY, clientY: e.clientY, y: 0, id: e.pointerId, gap: rects.length > 1 ? rects[1].top - rects[0].bottom : 0,
      scroller: item.closest('.panel') || document.scrollingElement, scroll0: 0 };
    d.scroll0 = d.scroller.scrollTop;
    list.classList.add('dragging');
    item.classList.add('lifting');
    buzz();
    d.raf = requestAnimationFrame(autoScroll);
  });

  document.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    d.clientY = e.clientY;
    move(e.clientY);
  });

  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    cancelAnimationFrame(d.raf);
    const { item, list, items, rects, from, to } = d;
    d = null;
    // Lleva la tarjeta a su hueco y luego guarda el orden.
    const target = to === from ? 0 : to > from ? rects[to].bottom - rects[from].bottom : rects[to].top - rects[from].top;
    item.classList.remove('lifting');
    item.classList.add('settling');
    item.style.transform = `translateY(${target}px)`;
    setTimeout(() => {
      list.classList.remove('dragging');
      items.forEach((el) => { el.style.transform = ''; el.classList.remove('settling'); });
      if (to !== from) onDrop(list.dataset.list, from, to);
    }, 190);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}
