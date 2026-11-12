// Previsión orientativa del IRPF (España, territorio común, persona soltera sin hijos).
// No sustituye al simulador de la Agencia Tributaria.

const SCALE = [[12450, 0.19], [20200, 0.24], [35200, 0.3], [60000, 0.37], [300000, 0.45], [Infinity, 0.47]];
const PERSONAL_MIN = 5550;
const OTHER_EXPENSES = 2000;
export const LIMIT_ONE_PAYER = 22000;
export const LIMIT_TWO_PAYERS = 15876;
export const SECOND_PAYER_MIN = 1500;

function scale(base) {
  let tax = 0, prev = 0;
  for (const [top, rate] of SCALE) {
    if (base <= prev) break;
    tax += (Math.min(base, top) - prev) * rate;
    prev = top;
  }
  return tax;
}

// Cuota anual estimada a partir del bruto y de las cotizaciones del trabajador.
export function quota(gross, ss) {
  const net = gross - ss;
  let reduction = 0;
  if (net <= 14852) reduction = 7302;
  else if (net <= 17673.52) reduction = 7302 - 1.75 * (net - 14852);
  else if (net <= 19747.5) reduction = 2364.34 - 1.14 * (net - 17673.52);
  const base = Math.max(0, net - OTHER_EXPENSES - reduction);
  return Math.max(0, scale(base) - scale(Math.min(base, PERSONAL_MIN)));
}

export function forecast(db, year) {
  const slips = db.payslips.filter((p) => p.gross > 0);
  if (!slips.length) return null;
  const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
  const allGross = sum(slips, (p) => p.gross);
  const ssRate = sum(slips, (p) => p.ss) / allGross || 0.065;
  const netRate = sum(slips, (p) => p.net) / allGross;
  const monthly = allGross / slips.length;
  const latest = [...slips].sort((a, b) => (a.from < b.from ? 1 : -1))[0];
  const pct = latest.irpfPct ?? 2;

  const mine = slips.filter((p) => +p.from.slice(0, 4) === year);
  const covered = new Set(mine.map((p) => +p.from.slice(5, 7)));
  const realGross = sum(mine, (p) => p.gross);
  const realRet = sum(mine, (p) => p.irpf);

  // Ingresos de nómina sin recibo: corresponden al mes anterior al cobro.
  let estGross = 0;
  for (const m of db.movements) {
    if (m.cat !== 'nomina' || slips.some((p) => Math.abs(p.net - m.amount) < 0.01)) continue;
    let y = +m.date.slice(0, 4), mo = +m.date.slice(5, 7) - 1;
    if (mo === 0) { mo = 12; y--; }
    if (y !== year || covered.has(mo)) continue;
    covered.add(mo);
    estGross += m.amount / netRate;
  }
  const last = covered.size ? Math.max(...covered) : new Date().getMonth();
  const monthsLeft = 12 - last;
  const futureGross = monthsLeft * monthly;

  const other = db.settings.tax || {};
  const otherGross = other.otherGross || 0;
  const otherRet = other.otherRet || 0;
  const gross = realGross + estGross + futureGross + otherGross;
  const withheld = realRet + ((estGross + futureGross) * pct) / 100 + otherRet;
  const q = quota(gross, gross * ssRate);
  const obliged = gross > (otherGross > SECOND_PAYER_MIN ? LIMIT_TWO_PAYERS : LIMIT_ONE_PAYER);

  const fullGross = monthly * 12;
  const fullQuota = quota(fullGross, fullGross * ssRate);
  const fullWithheld = (fullGross * pct) / 100;
  return {
    year, pct, monthly, realGross, estGross, futureGross, monthsLeft, otherGross, otherRet,
    gross, ss: gross * ssRate, withheld, quota: q, result: q - withheld, obliged,
    next: {
      year: year + 1, gross: fullGross, quota: fullQuota, withheld: fullWithheld, result: fullQuota - fullWithheld,
      obliged: fullGross > LIMIT_ONE_PAYER, neededPct: fullGross ? (fullQuota / fullGross) * 100 : 0,
    },
  };
}
