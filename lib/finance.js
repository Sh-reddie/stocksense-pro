/**
 * StockSense Pro — Pure financial math
 * --------------------------------------------------------------------------
 * These functions are extracted, verbatim in logic, from the calculators that
 * currently live inline in index.html (calcATR, xirr, calcKelly, calcPositionSize,
 * P&L). They are kept DOM-free and side-effect-free so they can be unit tested
 * and reused by both the web app and the Telegram worker.
 *
 * Usage:
 *   - Node / tests:   import { xirr, kelly } from './lib/finance.js'
 *   - Browser:        <script type="module" src="/lib/finance.js"></script>
 *                     then call window.SSFinance.xirr(...)
 *
 * Every function returns plain values (numbers / objects / null) and never
 * touches the DOM, network, or globals.
 * --------------------------------------------------------------------------
 */

const MS_PER_DAY = 864e5;
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

/** Round to n decimal places, returning a Number (not a string). */
export function round(v, n = 2) {
  if (v == null || !isFinite(v)) return null;
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

/**
 * Average True Range (Wilder smoothing).
 * series: array of { h, l, c } daily bars (h/l optional → fall back to close).
 * Returns ATR rounded to 2dp, or null if not enough data.
 */
export function calcATR(series, period = 14) {
  if (!series || series.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < series.length; i++) {
    const h = series[i].h ?? series[i].c;
    const l = series[i].l ?? series[i].c;
    const pc = series[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return round(atr, 2);
}

/**
 * ATR-based stop loss for a position.
 * Returns { atr, atrStop, mult, ltp, pctFromLtp } or null.
 */
export function atrStop(series, ltp, mult = 1.5, period = 14) {
  const atr = calcATR(series, period);
  if (atr == null || !ltp) return null;
  const stop = round(ltp - atr * mult, 2);
  return { atr, atrStop: stop, mult, ltp, pctFromLtp: round((stop - ltp) / ltp * 100, 1) };
}

/**
 * XIRR via Newton-Raphson. cashflows: [{ amount, date }] where date is a
 * Date or epoch-ms. Outflows negative, inflows positive. Returns annualised
 * rate as a decimal (0.18 = 18%) or null.
 */
export function xirr(cashflows) {
  if (!cashflows || cashflows.length < 2) return null;
  const cf = cashflows.map(c => ({ amount: c.amount, t: +(c.date instanceof Date ? c.date : new Date(c.date)) }));
  let rate = 0.1;
  const t0 = cf[0].t;
  for (let i = 0; i < 100; i++) {
    let fv = 0, dfv = 0;
    for (const c of cf) {
      const t = (c.t - t0) / MS_PER_YEAR;
      const v = Math.pow(1 + rate, t);
      fv += c.amount / v;
      dfv -= t * c.amount / (v * (1 + rate));
    }
    if (Math.abs(dfv) < 1e-12) break;
    const newRate = rate - fv / dfv;
    if (Math.abs(newRate - rate) < 1e-7) return newRate;
    rate = newRate;
    if (rate < -0.999) rate = -0.999;
  }
  return rate;
}

/**
 * XIRR for a single holding (buy → today), guarded the same way the app does.
 * Returns rate or null if held < minDays or result is unreasonable.
 */
export function holdingXIRR({ qty, avgPrice, ltp, buyDate }, now = Date.now(), minDays = 30) {
  const bd = buyDate ? new Date(buyDate) : null;
  if (!bd || isNaN(bd)) return null;
  if ((now - bd.getTime()) / MS_PER_DAY < minDays) return null;
  const price = ltp || avgPrice;
  const rate = xirr([
    { amount: -(qty * avgPrice), date: bd },
    { amount: qty * price, date: new Date(now) },
  ]);
  return rate != null && isFinite(rate) && Math.abs(rate) <= 10 ? rate : null;
}

/**
 * Kelly criterion for a trade setup.
 * f* = (b·p − q) / b,  b = reward/risk,  p = win prob,  q = 1−p.
 * Returns { b, full, half, quarter, ev, evPct, valid } or null on bad input.
 */
export function kelly({ entry, sl, target, winPct = 55 }) {
  if (!entry || !sl || !target || sl >= entry || target <= entry) return null;
  const p = winPct / 100;
  const q = 1 - p;
  const risk = entry - sl;
  const reward = target - entry;
  const b = reward / risk;
  const full = Math.max(0, (b * p - q) / b);
  const ev = p * reward - q * risk;
  return {
    b: round(b, 4),
    full: round(full, 6),
    half: round(full / 2, 6),
    quarter: round(full / 4, 6),
    ev: round(ev, 2),
    evPct: round(ev / entry * 100, 2),
    valid: ev >= 0,
  };
}

/**
 * Risk-based position sizing. Mirrors calcPositionSize().
 * qty is the smaller of (risk-budget / risk-per-share) and (max-position-cap / entry).
 * Returns { qty, invest, maxLoss, portPct, slPct } or null on bad input.
 */
export function positionSize({ portfolio, entry, sl, riskPct = 2, maxPosPct = 10 }) {
  if (!portfolio || !entry || !sl || sl >= entry) return null;
  const riskAmount = portfolio * riskPct / 100;
  const riskPerShare = entry - sl;
  const slPct = riskPerShare / entry * 100;
  const qtyByRisk = Math.floor(riskAmount / riskPerShare);
  const maxByPos = Math.floor((portfolio * maxPosPct / 100) / entry);
  const qty = Math.min(qtyByRisk, maxByPos);
  const invest = qty * entry;
  const maxLoss = qty * riskPerShare;
  return {
    qty,
    invest: round(invest, 2),
    maxLoss: round(maxLoss, 2),
    portPct: round(invest / portfolio * 100, 2),
    slPct: round(slPct, 2),
    cappedByPosition: qtyByRisk > maxByPos,
  };
}

/**
 * Unrealised P&L for a holding.
 * Returns { pnl, pnlPct, invested, current }.
 */
export function pnl({ qty, avgPrice, ltp }) {
  const price = ltp ?? avgPrice;
  const invested = qty * avgPrice;
  const current = qty * price;
  return {
    invested: round(invested, 2),
    current: round(current, 2),
    pnl: round(current - invested, 2),
    pnlPct: avgPrice ? round((price - avgPrice) / avgPrice * 100, 2) : null,
  };
}

/** Compound annual growth rate from start→end value over a number of years. */
export function cagr(startValue, endValue, years) {
  if (!startValue || startValue <= 0 || !years || years <= 0 || endValue == null) return null;
  return round((Math.pow(endValue / startValue, 1 / years) - 1) * 100, 2);
}

/** True if ltp has breached (<=) the stop loss. */
export function isStopBreached({ stopLoss, ltp }) {
  return !!(stopLoss && ltp && ltp <= stopLoss);
}

// Expose on window for the no-build browser app.
if (typeof window !== 'undefined') {
  window.SSFinance = {
    round, calcATR, atrStop, xirr, holdingXIRR, kelly, positionSize, pnl, cagr, isStopBreached,
  };
}
