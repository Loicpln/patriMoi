import { useState, useMemo, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, ComposedChart, Bar, Line, Brush, Customized,
} from "recharts";
import { useDevise, curMonth } from "../../context/DeviseContext";
import { POCHES, INVEST_SUBCATS, INVEST_SUBCAT_COLOR, TRADEABLE_SUBCATS, monthsBetween, tickerColor, tickerColorDim, TOOLTIP_STYLE } from "../../constants";
import { useQuotes } from "../../hooks/useQuotes";
import { ChartGrid, NestedPie, AccordionSection } from "./shared";
import { PositionModal, VersementModal, SellModal, TradeModal, DividendeModal, DeletePositionModal, ScpiValuationModal } from "./modals";
import type { Position, Vente, Dividende, Versement, ScpiValuation } from "./types";
import { SUBCAT_ORDER } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────────
const MN_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

function subcatIdx(key: string) {
  const i = SUBCAT_ORDER.indexOf(key as any);
  return i >= 0 ? i : 99;
}

/** Returns the minimum decimal precision needed to display all quantities,
 *  at least 2 and at most `max` (default 8). Trailing zeros are ignored. */
function qtyPrecision(quantities: number[], max = 8): number {
  let prec = 2;
  for (const n of quantities) {
    // strip trailing zeros from fixed representation
    const s = n.toFixed(max).replace(/\.?0+$/, "");
    const dot = s.indexOf(".");
    const d = dot >= 0 ? s.length - dot - 1 : 0;
    prec = Math.max(prec, d);
    if (prec >= max) return max;
  }
  return prec;
}

// Apply one buy/sell event to a mutable map (chronological order required for correct PRU)
type PortfolioMap = Record<string, { nom: string; subcat: string; q: number; inv: number }>;
function applyBuy(map: PortfolioMap, ticker: string, nom: string, subcat: string, qty: number, price: number) {
  if (!map[ticker]) map[ticker] = { nom, subcat, q: 0, inv: 0 };
  map[ticker].q   += qty;
  map[ticker].inv += qty * price;
}
function applySell(map: PortfolioMap, ticker: string, qty: number) {
  if (!map[ticker]) return;
  const pru = map[ticker].q > 0 ? map[ticker].inv / map[ticker].q : 0;
  map[ticker].q   = Math.max(0, map[ticker].q - qty);
  map[ticker].inv = Math.max(0, map[ticker].inv - qty * pru);
  if (map[ticker].q <= 1e-9) delete map[ticker];
}

// Aggregate positions for a given month — events processed chronologically so
// buy→sell→rebuy yields the correct PRU for each leg independently.
function aggregateByTicker(
  positions: Position[],
  ventes: Vente[],
  mois: string
): { ticker: string; nom: string; subcat: string; quantite: number; investTotal: number; pru: number }[] {
  type Ev =
    | { date: string; type: "buy"; ticker: string; nom: string; subcat: string; qty: number; price: number }
    | { date: string; type: "sell"; ticker: string; qty: number };

  const events: Ev[] = [
    ...positions
      .filter(p => (p.date_achat ?? "").slice(0, 7) <= mois)
      .map(p => ({ date: p.date_achat ?? "", type: "buy" as const, ticker: p.ticker, nom: p.nom, subcat: p.sous_categorie ?? "actions", qty: p.quantite, price: p.prix_achat })),
    ...ventes
      .filter(v => (v.date_vente ?? "").slice(0, 7) <= mois)
      .map(v => ({ date: v.date_vente ?? "", type: "sell" as const, ticker: v.ticker, qty: v.quantite })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const map: PortfolioMap = {};
  events.forEach(ev => {
    if (ev.type === "buy") applyBuy(map, ev.ticker, ev.nom, ev.subcat, ev.qty, ev.price);
    else                   applySell(map, ev.ticker, ev.qty);
  });

  return Object.entries(map).map(([ticker, d]) => ({
    ticker, nom: d.nom, subcat: d.subcat,
    quantite: d.q, investTotal: d.inv,
    pru: d.q > 0 ? d.inv / d.q : 0,
  }));
}

// Generate daily dates starting from firstMonth-01 up to today
function genDailyDates(firstMonth: string): string[] {
  const dates: string[] = [];
  const cur = new Date(firstMonth + "-01");
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  while (cur <= now) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// For each event date, find which daily-point bucket it belongs to
// (latest dayDate <= eventDate)
function assignToWeek(weekDates: string[], eventDate: string): string | null {
  if (!eventDate) return null;
  let lo = 0, hi = weekDates.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (weekDates[mid] <= eventDate) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found >= 0 ? weekDates[found] : null;
}

// Build daily data using actual per-day prices
function buildWeeklyData(
  positions: Position[],
  ventes: Vente[],
  dividendes: Dividende[],
  versements: Versement[],
  getPriceForDate: (ticker: string, dateStr: string, pru?: number) => number,
  allTickers: string[],
  scpiPrices: Record<string, Record<string, number>> = {}
): { date: string; month: string; [k: string]: number | string }[] {
  if (!positions.length) return [];

  const allDates = positions.map(p => (p.date_achat ?? "").slice(0, 7)).filter(Boolean).sort();
  const firstMonth = allDates[0];
  const dayDates   = genDailyDates(firstMonth);

  // ── Pre-sort all events chronologically ────────────────────────────────────
  type Ev =
    | { date: string; type: "buy"; ticker: string; nom: string; subcat: string; qty: number; price: number }
    | { date: string; type: "sell"; ticker: string; qty: number };
  const allEvents: Ev[] = [
    ...positions.map(p => ({ date: p.date_achat ?? "", type: "buy"  as const, ticker: p.ticker, nom: p.nom, subcat: p.sous_categorie ?? "actions", qty: p.quantite, price: p.prix_achat })),
    ...ventes.map(v    => ({ date: v.date_vente  ?? "", type: "sell" as const, ticker: v.ticker, qty: v.quantite })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Pre-sort sparse event lists for O(n) cumulative scans
  const sortedVers  = [...versements].sort((a, b) => (a.date         ?? "").localeCompare(b.date         ?? ""));
  const sortedVentC = [...ventes]    .sort((a, b) => (a.date_vente   ?? "").localeCompare(b.date_vente   ?? ""));
  const sortedDivC  = [...dividendes].sort((a, b) => (a.date         ?? "").localeCompare(b.date         ?? ""));

  // ── Incremental state ──────────────────────────────────────────────────────
  const byT: PortfolioMap = {};
  let evIdx = 0;

  // Per-day event maps (dividends + realized PnL on their exact date)
  const divsByDay:  Record<string, Record<string, number>> = {};
  const realByDay:  Record<string, Record<string, number>> = {};
  dividendes.forEach(d => {
    const dk = d.date ?? ""; if (!dk) return;
    if (!divsByDay[dk])  divsByDay[dk]  = {};
    divsByDay[dk][d.ticker] = (divsByDay[dk][d.ticker] ?? 0) + d.montant;
  });
  ventes.forEach(v => {
    const vk = v.date_vente ?? ""; if (!vk) return;
    if (!realByDay[vk]) realByDay[vk] = {};
    realByDay[vk][v.ticker] = (realByDay[vk][v.ticker] ?? 0) + v.pnl;
  });

  // Cumulative running totals
  let cumVers = 0, viC = 0;
  let cumPnl  = 0, piC = 0;
  let cumDivs = 0, diC = 0;

  // ── Main loop — one entry per calendar day ─────────────────────────────────
  const result: { date: string; month: string; [k: string]: number | string }[] = [];

  for (const dateStr of dayDates) {
    // Apply portfolio events up to and including this day
    while (evIdx < allEvents.length && allEvents[evIdx].date <= dateStr) {
      const ev = allEvents[evIdx++];
      if (ev.type === "buy") applyBuy(byT, ev.ticker, ev.nom, ev.subcat, ev.qty, ev.price);
      else                   applySell(byT, ev.ticker, ev.qty);
    }

    // Advance cumulative counters
    while (viC < sortedVers.length  && (sortedVers[viC].date        ?? "") <= dateStr) cumVers += sortedVers[viC++].montant;
    while (piC < sortedVentC.length && (sortedVentC[piC].date_vente ?? "") <= dateStr) cumPnl  += sortedVentC[piC++].pnl;
    while (diC < sortedDivC.length  && (sortedDivC[diC].date        ?? "") <= dateStr) cumDivs += sortedDivC[diC++].montant;

    // Portfolio value at this day's close price
    const snap: Record<string, number> = {};
    let totalValue = 0, totalInvest = 0;
    for (const [ticker, d] of Object.entries(byT)) {
      const pru = d.q > 0 ? d.inv / d.q : 0;
      let unitPrice: number;
      if (d.subcat === "fond") {
        unitPrice = 1.0;
      } else if (d.subcat === "scp") {
        const mm = scpiPrices[ticker] ?? {};
        const keys = Object.keys(mm).filter(k => k <= dateStr.slice(0, 7)).sort();
        unitPrice = keys.length ? mm[keys[keys.length - 1]] : pru;
      } else {
        unitPrice = getPriceForDate(ticker, dateStr, pru);
      }
      const val = d.q * unitPrice;
      snap[ticker]  = val;
      totalValue   += val;
      totalInvest  += d.inv;
    }

    const pnlLatent = totalValue - totalInvest;
    const perTickerPnlLat: Record<string, number> = {};
    for (const [ticker, d] of Object.entries(byT))
      perTickerPnlLat[ticker] = (snap[ticker] ?? 0) - d.inv;

    const dayDivsMap = divsByDay[dateStr]  ?? {};
    const dayRealMap = realByDay[dateStr]  ?? {};
    const totalDivs  = Object.values(dayDivsMap).reduce((s, v) => s + v, 0);
    const totalReal  = Object.values(dayRealMap).reduce((s, v) => s + v, 0);

    const especes  = Math.max(0, cumVers + cumPnl + cumDivs - totalInvest);
    const lossArea = Math.max(0, cumVers - (totalValue + especes));
    const pnlTotal = (totalValue - totalInvest) + cumPnl + cumDivs;

    const row: { date: string; month: string; [k: string]: number | string } = {
      date: dateStr, month: dateStr.slice(0, 7),
      _especes:   especes,
      ...snap,
      _pnlLatent: pnlLatent,
      _pnlReal:   totalReal,
      _divs:      totalDivs,
      _versTotal: cumVers,
      _lossArea:  lossArea,
      _pnlTotal:  pnlTotal,
    };
    allTickers.forEach(ticker => {
      row[`_pnlLat_${ticker}`]  = perTickerPnlLat[ticker] ?? 0;
      row[`_pnlReal_${ticker}`] = dayRealMap[ticker]      ?? 0;
      row[`_divs_${ticker}`]    = dayDivsMap[ticker]      ?? 0;
    });
    // Special: intérêts not linked to a position
    row[`_divs__INTERETS_`] = dayDivsMap["_INTERETS_"] ?? 0;
    result.push(row);
  }
  return result;
}

// Index-based pixel: bypasses Recharts scale (which only contains ticks in its domain)
function idxPx(data: any[], x1: string, x2: string, offset: any, bStart = 0, bEnd?: number) {
  const end = bEnd ?? data.length - 1;
  const N = end - bStart + 1;
  if (N <= 0) return null;
  const ai1 = data.findIndex((d: any) => d.date === x1);
  let ai2 = -1; for (let i = data.length - 1; i >= 0; i--) { if ((data[i] as any).date === x2) { ai2 = i; break; } }
  if (ai1 < 0 || ai2 < 0) return null;
  const r1 = Math.max(0, ai1 - bStart); const r2 = Math.min(N - 1, ai2 - bStart);
  if (r2 < 0 || r1 >= N) return null;
  const denom = Math.max(1, N - 1);
  const step = N > 1 ? offset.width / (N - 1) : offset.width;
  return { rx1: offset.left + (r1 / denom) * offset.width, rx2: offset.left + (r2 / denom) * offset.width, step };
}

// ── Custom poche tooltip: versements first row + +/– sign, then items ─────────
function PocheTooltip({ active, payload, label, fmt: fmtFn }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const pnlTotal: number | null  = row._pnlTotal ?? null;
  const vers:     number | undefined = row._versTotal;

  const SKIP = new Set(["_lossArea", "_versTotal", "_pnlTotal"]);
  const items = payload.filter(
    (p: any) => !SKIP.has(p.dataKey) && p.value !== 0 && p.value != null,
  );
  if (!items.length && vers == null) return null;

  return (
    <div style={{ ...TOOLTIP_STYLE, padding: "10px 14px", minWidth: 190 }}>
      {label && <div style={{ color: "var(--text-2)", fontSize: 9, marginBottom: 8, letterSpacing: ".05em" }}>{label}</div>}
      {vers != null && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 6, borderBottom: "1px solid var(--border)", paddingBottom: 5 }}>
          <span style={{ color: "#e63946", fontSize: 10 }}>Versements&nbsp;{fmtFn(vers)}</span>
          {pnlTotal != null && (
            <span style={{ color: pnlTotal >= 0 ? "var(--teal)" : "var(--rose)", fontSize: 11, fontWeight: 700 }}>
              {pnlTotal >= 0 ? "+" : "−"}{fmtFn(Math.abs(pnlTotal))}
            </span>
          )}
        </div>
      )}
      {items.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
          <span style={{ color: p.color ?? p.stroke ?? p.fill ?? "var(--text-1)", fontSize: 10 }}>{p.name || p.dataKey}</span>
          <span style={{ color: "var(--text-0)", fontSize: 10 }}>{fmtFn(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export function PocheSection({ poche, allPositions, allVentes, allDividendes, allVersements, mois, onRefresh }: {
  poche: typeof POCHES[number]; allPositions: Position[]; allVentes: Vente[];
  allDividendes: Dividende[]; allVersements: Versement[]; mois: string; onRefresh: () => void;
}) {
  const { fmt } = useDevise();
  const [open, setOpen]           = useState(false);
  const [posModal, setPosModal]   = useState(false);
  const [divModal, setDivModal]   = useState(false);
  const [verModal, setVerModal]   = useState(false);
  const [sellTarget, setSellTarget]   = useState<{ ticker: string; nom: string; tickerPositions: Position[]; tickerVentes: Vente[] } | null>(null);
  const [tradeTarget, setTradeTarget] = useState<{ ticker: string; nom: string; subcat: string; tickerPositions: Position[]; tickerVentes: Vente[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ticker: string; rows: Position[] } | null>(null);
  const [pieToggle, setPieToggle] = useState<"investi" | "valeur">("valeur");
  const [pnlMode, setPnlMode]     = useState<"latent" | "realise" | "divs">("latent");
  const [brushIdx, setBrushIdx] = useState<{ start: number; end: number } | null>(null);
  const [scpiModal, setScpiModal] = useState(false);
  const [scpiValuations, setScpiValuations] = useState<ScpiValuation[]>([]);

  const positions  = useMemo(() => allPositions.filter(p => p.poche === poche.key),  [allPositions, poche.key]);
  const ventes     = useMemo(() => allVentes.filter(v => v.poche === poche.key),      [allVentes, poche.key]);
  const dividendes = useMemo(() => allDividendes.filter(d => d.poche === poche.key),  [allDividendes, poche.key]);
  const versements = useMemo(() => allVersements.filter(v => v.poche === poche.key),  [allVersements, poche.key]);

  const fromMonth = useMemo(() => {
    const dates = positions.map(p => (p.date_achat ?? "").slice(0, 7)).filter(Boolean).sort();
    return dates[0] ?? curMonth;
  }, [positions]);

  const allTickers = useMemo(() =>
    [...new Set(positions.map(p => p.ticker))].map(t => ({
      ticker: t, nom: positions.find(p => p.ticker === t)?.nom ?? t, color: tickerColor(t),
    })),
  [positions]);

  const tickers = useMemo(() => allTickers.map(t => t.ticker), [allTickers]);
  // Fond (1€ fixed) and SCPI (manual) don't need Yahoo Finance quotes
  const tickersForYahoo = useMemo(() => tickers.filter(t => {
    const sub = positions.find(p => p.ticker === t)?.sous_categorie ?? "";
    return sub !== "fond" && sub !== "scp";
  }), [tickers, positions]);
  const { quotes, getPrice: _getPrice, getPriceForDate, loading, refresh } = useQuotes(tickersForYahoo, fromMonth);
  // Override getPrice: fond=1€, scp=manual valuation, else yahoo
  const scpiPriceMap = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    scpiValuations.forEach(v => {
      if (!m[v.ticker]) m[v.ticker] = {};
      m[v.ticker][v.mois] = v.valeur_unit;
    });
    return m;
  }, [scpiValuations]);
  const getPrice = useCallback((ticker: string, month: string, pru = 0): number => {
    const sub = positions.find(p => p.ticker === ticker)?.sous_categorie ?? "";
    if (sub === "fond") return 1.0;
    if (sub === "scp") {
      const mm = scpiPriceMap[ticker] ?? {};
      const keys = Object.keys(mm).filter(k => k <= month).sort();
      if (keys.length) return mm[keys[keys.length - 1]];
      return pru;
    }
    return _getPrice(ticker, month, pru);
  }, [_getPrice, positions, scpiPriceMap]);

  // Date-aware price lookup (for sell modal): same as getPrice but accepts a full date string
  const getPriceForDateFull = useCallback((ticker: string, dateStr: string, pru = 0): number => {
    const sub = positions.find(p => p.ticker === ticker)?.sous_categorie ?? "";
    if (sub === "fond") return 1.0;
    if (sub === "scp") {
      const month = dateStr.slice(0, 7);
      const mm = scpiPriceMap[ticker] ?? {};
      const keys = Object.keys(mm).filter(k => k <= month).sort();
      return keys.length ? mm[keys[keys.length - 1]] : pru;
    }
    return getPriceForDate(ticker, dateStr, pru);
  }, [positions, scpiPriceMap, getPriceForDate]);

  // All positions in this poche with tradeable subcats (for TradeModal destination dropdown)
  const tradeablePositions = useMemo(
    () => positions.filter(p => (TRADEABLE_SUBCATS as readonly string[]).includes(p.sous_categorie ?? '')),
    [positions],
  );

  // Load SCPI valuations for this poche
  useEffect(() => {
    invoke<ScpiValuation[]>("get_scpi_valuations", { poche: poche.key })
      .then(setScpiValuations).catch(() => {});
  }, [poche.key]);

  const byTicker = useMemo(() => aggregateByTicker(positions, ventes, mois), [positions, ventes, mois]);

  const enriched = useMemo(() => byTicker.map(t => {
    const q = quotes[t.ticker];
    const currentPrice = getPrice(t.ticker, mois, t.pru);
    const currentValue = t.quantite * currentPrice;
    const pnl    = currentValue - t.investTotal;
    const pnlPct = t.investTotal > 0 ? (pnl / t.investTotal) * 100 : 0;
    return { ...t, currentPrice, currentValue, pnl, pnlPct, quote: q, color: tickerColor(t.ticker) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [byTicker, quotes, getPrice, mois]);

  const totalInvest  = enriched.reduce((s, p) => s + p.investTotal, 0);
  const totalValue   = enriched.reduce((s, p) => s + p.currentValue, 0);
  const totalPnlOpen = totalValue - totalInvest;
  const totalPnlReal = ventes.filter(v => (v.date_vente ?? "").slice(0, 7) <= mois).reduce((s, v) => s + v.pnl, 0);
  const totalDivs    = dividendes.filter(d => (d.date ?? "").slice(0, 7) <= mois).reduce((s, d) => s + d.montant, 0);
  const totalVers    = versements.filter(v => (v.date ?? "").slice(0, 7) <= mois).reduce((s, v) => s + v.montant, 0);
  const especes      = Math.max(0, totalVers + totalPnlReal + totalDivs - totalInvest);

  // Dynamic quantity precision: max significant decimals across all quantities (≤ 8)
  const qtyPrec  = useMemo(() => qtyPrecision(enriched.map(p => p.quantite)), [enriched]);
  const ventPrec = useMemo(() => qtyPrecision(ventes.map(v => v.quantite)),   [ventes]);

  const chartData = useMemo(() => buildWeeklyData(positions, ventes, dividendes, versements, getPriceForDate, tickers, scpiPriceMap),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [positions, ventes, dividendes, versements, getPriceForDate, tickers, scpiPriceMap]);

  const sortedTickers = useMemo(() => [...allTickers].sort((a, b) => {
    const sa = positions.find(p => p.ticker === a.ticker)?.sous_categorie ?? "";
    const sb = positions.find(p => p.ticker === b.ticker)?.sous_categorie ?? "";
    return subcatIdx(sa) - subcatIdx(sb);
  }), [allTickers, positions]);

  // Visible slice driven by Brush indices (used for xTicks + month highlight)
  const visibleData = useMemo(() =>
    brushIdx ? chartData.slice(brushIdx.start, brushIdx.end + 1) : chartData,
  [chartData, brushIdx]);

  // First date of each visible month (XAxis tick marks — ≤ 8 labels)
  const xTicks = useMemo(() => {
    const seen = new Set<string>();
    const firsts: string[] = [];
    visibleData.forEach((d: any) => {
      const m = (d.date as string).slice(0, 7);
      if (!seen.has(m)) { seen.add(m); firsts.push(d.date as string); }
    });
    const step = Math.max(1, Math.ceil(firsts.length / 8));
    return firsts.filter((_, i) => i % step === 0);
  }, [visibleData]);

  // Day-dates inside the selected month (gold ReferenceArea)
  const monthWeekRange = useMemo(() => {
    const inMonth = visibleData.filter((d: any) => d.month === mois);
    if (!inMonth.length) return null;
    return { x1: inMonth[0].date as string, x2: inMonth[inMonth.length - 1].date as string };
  }, [visibleData, mois]);

  // Brush onChange for the portfolio (stack) chart
  const onBrushChange = (range: any) => {
    const { startIndex: s, endIndex: e } = range ?? {};
    if (s === undefined || e === undefined) return;
    const isFullRange = s === 0 && e === chartData.length - 1;
    setBrushIdx(isFullRange ? null : { start: s, end: e });
  };

  // Weekly aggregation of PnL/divs: sum per ISO week so bars are readable.
  // Starts from the ISO week of the first position (not the beginning of that month).
  const weeklyPnlData = useMemo(() => {
    if (!chartData.length) return [];

    // Compute Monday of the first position's week
    const firstPosDate = positions.map(p => p.date_achat ?? "").filter(Boolean).sort()[0] ?? "";
    let firstPosWeek = "";
    if (firstPosDate) {
      const [fy, fm, fd] = firstPosDate.split("-").map(Number);
      const fd0 = new Date(fy, fm - 1, fd);
      const dow = fd0.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(fy, fm - 1, fd + diff);
      firstPosWeek = `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,"0")}-${String(mon.getDate()).padStart(2,"0")}`;
    }

    const weeks = new Map<string, any>();
    (chartData as any[]).forEach(row => {
      // Parse date components locally (avoids UTC-midnight timezone shift)
      const [y, mo, dy] = (row.date as string).split("-").map(Number);
      const d = new Date(y, mo - 1, dy);
      const dow = d.getDay(); // 0=Sun
      const diff = dow === 0 ? -6 : 1 - dow; // days back to Monday
      const mon = new Date(y, mo - 1, dy + diff);
      const wk = `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,"0")}-${String(mon.getDate()).padStart(2,"0")}`;
      if (!weeks.has(wk)) {
        const base: any = { date: wk, month: wk.slice(0, 7) };
        tickers.forEach(t => { base[`_pnlReal_${t}`] = 0; base[`_divs_${t}`] = 0; base[`_pnlLat_${t}`] = 0; });
        base[`_divs__INTERETS_`] = 0;
        weeks.set(wk, base);
      }
      const w = weeks.get(wk);
      tickers.forEach(t => {
        w[`_pnlReal_${t}`] += (row[`_pnlReal_${t}`] as number) ?? 0;
        w[`_divs_${t}`]    += (row[`_divs_${t}`]    as number) ?? 0;
        w[`_pnlLat_${t}`]  = (row[`_pnlLat_${t}`]  as number) ?? 0; // last day of week
      });
      w[`_divs__INTERETS_`] += (row[`_divs__INTERETS_`] as number) ?? 0;
    });
    return [...weeks.values()]
      .sort((a, b) => (a.date as string).localeCompare(b.date as string))
      .filter(w => !firstPosWeek || (w.date as string) >= firstPosWeek);
  }, [chartData, tickers, positions]);

  // Independent brush state for the PnL/divs chart
  const [pnlBrushIdx, setPnlBrushIdx] = useState<{ start: number; end: number } | null>(null);
  const pnlVisibleData = useMemo(() =>
    pnlBrushIdx ? weeklyPnlData.slice(pnlBrushIdx.start, pnlBrushIdx.end + 1) : weeklyPnlData,
  [weeklyPnlData, pnlBrushIdx]);

  const pnlXTicks = useMemo(() => {
    const seen = new Set<string>(); const firsts: string[] = [];
    pnlVisibleData.forEach((d: any) => { const m = (d.date as string).slice(0, 7); if (!seen.has(m)) { seen.add(m); firsts.push(d.date as string); } });
    const step = Math.max(1, Math.ceil(firsts.length / 8));
    return firsts.filter((_, i) => i % step === 0);
  }, [pnlVisibleData]);

  const pnlMonthRange = useMemo(() => {
    const inM = pnlVisibleData.filter((d: any) => d.month === mois);
    if (!inM.length) return null;
    return { x1: inM[0].date as string, x2: inM[inM.length - 1].date as string };
  }, [pnlVisibleData, mois]);

  const onPnlBrushChange = (range: any) => {
    const { startIndex: s, endIndex: e } = range ?? {};
    if (s === undefined || e === undefined) return;
    const isFullRange = s === 0 && e === weeklyPnlData.length - 1;
    setPnlBrushIdx(isFullRange ? null : { start: s, end: e });
  };

  // ── Pie data ──────────────────────────────────────────────────────────────────
  const pieInner = useMemo(() => {
    const map: Record<string, { v: number; c: string }> = {};
    enriched.forEach(p => {
      const val = pieToggle === "investi" ? p.investTotal : p.currentValue;
      if (!map[p.subcat]) map[p.subcat] = { v: 0, c: INVEST_SUBCAT_COLOR[p.subcat] ?? poche.color };
      map[p.subcat].v += val;
    });
    if (especes > 0) map["especes"] = { v: especes, c: INVEST_SUBCAT_COLOR["especes"] ?? "#78909c" };
    return [...Object.entries(map)]
      .sort(([a], [b]) => subcatIdx(a) - subcatIdx(b))
      .map(([k, v]) => ({ name: INVEST_SUBCATS.find(s => s.key === k)?.label ?? k, value: v.v, color: v.c }))
      .filter(p => p.value > 0);
  }, [enriched, pieToggle, especes, poche.color]);

  const pieOuter = useMemo(() => [
    ...enriched
      .sort((a, b) => subcatIdx(a.subcat) - subcatIdx(b.subcat))
      .map(p => ({
        name:  p.nom,
        group: INVEST_SUBCATS.find(s => s.key === p.subcat)?.label ?? p.subcat,
        value: pieToggle === "investi" ? p.investTotal : p.currentValue,
        color: tickerColorDim(p.ticker),
      })),
    ...(especes > 0 ? [{ name: "Espèces", group: "Espèces", value: especes, color: (INVEST_SUBCAT_COLOR["especes"] ?? "#78909c") + "99" }] : []),
  ].filter(p => p.value > 0), [enriched, pieToggle, especes]);

  const pieTotal = (pieToggle === "investi" ? totalInvest : totalValue) + especes;

  const summary = [
    { label: "Versements",     value: fmt(totalVers),    color: "var(--text-1)" },
    { label: "Investi",        value: fmt(totalInvest),  color: "var(--text-0)" },
    { label: `Valeur·${mois}`, value: fmt(totalValue + especes), color: "var(--teal)" },
    { label: "PnL latent",     value: `${totalPnlOpen >= 0 ? "+" : ""}${fmt(totalPnlOpen)}`, color: totalPnlOpen >= 0 ? "var(--teal)" : "var(--rose)" },
    { label: "PnL réalisé",    value: `${totalPnlReal >= 0 ? "+" : ""}${fmt(totalPnlReal)}`, color: totalPnlReal >= 0 ? "var(--teal)" : "var(--rose)" },
    { label: "Dividendes",     value: fmt(totalDivs),    color: "var(--gold)"   },
    { label: "Espèces",        value: fmt(especes),       color: INVEST_SUBCAT_COLOR["especes"] ?? "#78909c" },
  ];

  // ── Chart nodes ───────────────────────────────────────────────────────────────
  const pieNode = (h: number) => pieInner.length === 0
    ? <div className="empty">Aucune position pour ce mois</div>
    : <NestedPie inner={pieInner} outer={pieOuter} total={pieTotal} fmt={fmt} h={h}
        toggleLabel={pieToggle === "investi" ? "↔ Investi" : "↔ Valeur"}
        onToggle={() => setPieToggle(v => v === "investi" ? "valeur" : "investi")}/>;

  // Stacked area: value per ticker per day (actual daily close prices)
  // + red line/fill for cumulative versements (shows loss zone when portfolio < versements)
  const stackNode = (h: number, isExp: boolean) => chartData.length === 0
    ? <div className="empty">Aucune donnée</div>
    : (() => {
      // Compact: pass visibleData so zoom is preserved without the Brush component.
      // Expanded: pass full chartData + Brush slider for range selection.
      const chartDataForNode = isExp ? chartData : visibleData;
      return (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart data={chartDataForNode} margin={{ left: 0, right: 5, top: 5, bottom: isExp ? 28 : 0 }}>
            <defs>
              {sortedTickers.map(t => (
                <linearGradient key={t.ticker} id={`gs_${poche.key}_${t.ticker.replace(/\W/g, "_")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={t.color} stopOpacity={.75}/>
                  <stop offset="95%" stopColor={t.color} stopOpacity={.05}/>
                </linearGradient>
              ))}
              <linearGradient id={`gs_${poche.key}_loss`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#e63946" stopOpacity={.55}/>
                <stop offset="100%" stopColor="#e63946" stopOpacity={.15}/>
              </linearGradient>
              <linearGradient id={`gs_${poche.key}_cash`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={INVEST_SUBCAT_COLOR["especes"] ?? "#78909c"} stopOpacity={.7}/>
                <stop offset="95%" stopColor={INVEST_SUBCAT_COLOR["especes"] ?? "#78909c"} stopOpacity={.1}/>
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="date" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
              ticks={xTicks}
              tickFormatter={d => { const mo = parseInt(d.slice(5, 7)); return MN_SHORT[mo - 1]; }}/>
            {/* Y-axis clamped to [0, auto] — portfolio value can't be negative */}
            <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k€` : `${v}€`} width={45}
              domain={[0, "auto"]}/>
            {isExp && <Tooltip content={<PocheTooltip fmt={fmt}/>}/>}
            {/* Espèces — bottom of stack */}
            <Area type="monotone" dataKey="_especes" stackId="v" name="Espèces"
              stroke={INVEST_SUBCAT_COLOR["especes"] ?? "#78909c"} strokeWidth={1}
              fill={`url(#gs_${poche.key}_cash)`} legendType="none"/>
            {/* Stacked portfolio areas */}
            {sortedTickers.map(t => (
              <Area key={t.ticker} type="monotone" dataKey={t.ticker} stackId="v" name={t.nom}
                stroke={t.color} strokeWidth={1.5}
                fill={`url(#gs_${poche.key}_${t.ticker.replace(/\W/g, "_")})`}/>
            ))}
            {/* Loss zone: stacked on top of portfolio, fills gap up to versements line */}
            <Area type="monotone" dataKey="_lossArea" stackId="v" name="_lossArea"
              stroke="none" strokeWidth={0}
              fill={`url(#gs_${poche.key}_loss)`} legendType="none"/>
            {/* Versements cumulative line (not stacked — absolute value) */}
            <Line type="monotone" dataKey="_versTotal" name="Versements"
              stroke="#e63946" strokeWidth={1.5} dot={false} strokeDasharray="4 3" legendType="none"/>
            {/* Gold month highlight — index-based; when compact data is already sliced (bStart=0) */}
            {monthWeekRange && (
              <Customized component={(p: any) => {
                const bS = isExp ? (brushIdx?.start ?? 0) : 0;
                const bE = isExp ? (brushIdx?.end ?? chartData.length - 1) : visibleData.length - 1;
                const r = idxPx(chartDataForNode, monthWeekRange.x1, monthWeekRange.x2, p.offset, bS, bE);
                if (!r) return null;
                return <g><rect x={r.rx1} y={p.offset.top} width={Math.max(1, r.rx2 - r.rx1 + r.step)} height={p.offset.height}
                  fill="var(--gold)" fillOpacity={0.18} stroke="var(--gold)" strokeOpacity={0.6}
                  strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
              }}/>
            )}
            {/* Range slider for zoom — only in expanded view */}
            {isExp && <Brush dataKey="date" height={22} travellerWidth={6}
              stroke="var(--border)" fill="var(--bg-2)"
              startIndex={brushIdx?.start ?? 0}
              endIndex={brushIdx?.end ?? chartData.length - 1}
              onChange={onBrushChange}
              tickFormatter={() => ""}/>}
          </ComposedChart>
        </ResponsiveContainer>
      );
    })();

  // PnL + dividendes par ticker, événements assignés à leur semaine exacte
  const pnlDivNode = (h: number, isExp: boolean) => chartData.length === 0
    ? <div className="empty">Aucune donnée</div>
    : (() => {
      const pnlDataForNode = isExp ? weeklyPnlData : pnlVisibleData;
      return (
        <div style={{ height: h, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 8, flexShrink: 0 }}>
            {([["latent", "PnL latent"], ["realise", "PnL réalisé"], ["divs", "Dividendes"]] as const).map(([k, l]) => (
              <button key={k} className={`btn btn-sm ${pnlMode === k ? "btn-primary" : "btn-ghost"}`}
                style={{ flex: 1, fontSize: 10 }} onClick={() => setPnlMode(k)}>{l}</button>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pnlDataForNode} stackOffset="sign" margin={{ left: 0, right: 5, top: 5, bottom: isExp ? 28 : 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="date" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
                  ticks={pnlXTicks}
                  tickFormatter={d => { const mo = parseInt(d.slice(5, 7)); return MN_SHORT[mo - 1]; }}/>
                {pnlMode !== "divs" ? (
                  <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
                    tickFormatter={v => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k€` : `${v.toFixed(0)}€`} width={45}/>
                ) : (
                  <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
                    tickFormatter={v => v === 0 ? "0€" : Math.abs(v) >= 100 ? `${v.toFixed(0)}€` : `${v.toFixed(2)}€`} width={52}/>
                )}
                {isExp && <Tooltip content={<PocheTooltip fmt={fmt}/>}/>}
                <ReferenceLine y={0} stroke="var(--border-l)"/>
                {pnlMode === "latent" && sortedTickers.map(t => (
                  <Line key={t.ticker} type="monotone" dataKey={`_pnlLat_${t.ticker}`} name={t.nom}
                    stroke={t.color} strokeWidth={1.5} dot={false}/>
                ))}
                {pnlMode === "realise" && sortedTickers.map(t => (
                  <Bar key={t.ticker} dataKey={`_pnlReal_${t.ticker}`} name={t.nom}
                    stackId="r" fill={t.color} radius={[0, 0, 0, 0]}/>
                ))}
                {/* Intérêts espèces — en premier dans le stack (barre du bas) */}
                {pnlMode === "divs" && (
                  <Bar dataKey="_divs__INTERETS_" name="Intérêts"
                    stackId="d" fill={INVEST_SUBCAT_COLOR["especes"] ?? "#78909c"} radius={[0, 0, 0, 0]}/>
                )}
                {pnlMode === "divs" && sortedTickers.map(t => (
                  <Bar key={t.ticker} dataKey={`_divs_${t.ticker}`} name={t.nom}
                    stackId="d" fill={t.color} radius={[0, 0, 0, 0]}/>
                ))}
                {/* Gold month highlight — index-based */}
                {pnlMonthRange && (
                  <Customized component={(p: any) => {
                    const bS = isExp ? (pnlBrushIdx?.start ?? 0) : 0;
                    const bE = isExp ? (pnlBrushIdx?.end ?? weeklyPnlData.length - 1) : pnlVisibleData.length - 1;
                    const r = idxPx(pnlDataForNode, pnlMonthRange.x1, pnlMonthRange.x2, p.offset, bS, bE);
                    if (!r) return null;
                    return <g><rect x={r.rx1} y={p.offset.top} width={Math.max(1, r.rx2 - r.rx1 + r.step)} height={p.offset.height}
                      fill="var(--gold)" fillOpacity={0.18} stroke="var(--gold)" strokeOpacity={0.6}
                      strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
                  }}/>
                )}
                {/* Range slider — independent from portfolio chart, only in expanded view */}
                {isExp && <Brush dataKey="date" height={22} travellerWidth={6}
                  stroke="var(--border)" fill="var(--bg-2)"
                  startIndex={pnlBrushIdx?.start ?? 0}
                  endIndex={pnlBrushIdx?.end ?? weeklyPnlData.length - 1}
                  onChange={onPnlBrushChange}
                  tickFormatter={() => ""}/>}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    })();

  return (
    <div className="table-card" style={{ marginBottom: 12 }}>
      <div className="poche-header" onClick={() => setOpen(v => !v)} style={{ cursor: "pointer", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, transform: open ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform .2s", color: "var(--text-2)" }}>▶</span>
          <span className="poche-title" style={{ color: poche.color }}>{poche.label}</span>
          <span style={{ fontSize: 11, color: "var(--text-1)" }}>
            {fmt(totalValue + especes)}&nbsp;·&nbsp;
          {(() => { const pnlTot = totalPnlOpen + totalPnlReal + totalDivs; return <span style={{ color: pnlTot >= 0 ? "var(--teal)" : "var(--rose)", fontWeight: 600 }}>{pnlTot >= 0 ? "+" : "−"}{fmt(Math.abs(pnlTot))}</span>; })()}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
          {loading && <span className="spinner"/>}
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setVerModal(true)}>+ Versement</button>
          {positions.length > 0 && <button className="btn btn-teal btn-sm" onClick={() => setDivModal(true)}>+ Dividende</button>}
          {positions.some(p => p.sous_categorie === "scp") && (
            <button className="btn btn-sm btn-ghost" onClick={() => setScpiModal(true)} style={{ fontSize: 10 }}>📊 SCPI</button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setPosModal(true)}>+ Position</button>
        </div>
      </div>

      {open && (
        <div>
          <div style={{ display: "flex", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            {summary.map(s => (
              <div key={s.label} style={{ minWidth: 90 }}>
                <div style={{ fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-2)", marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <ChartGrid charts={[
            { key: `pie_${poche.key}`,    title: `Répartition · ${mois}`,          node: pieNode    },
            { key: `stack_${poche.key}`,  title: "Valeur portefeuille / jour",      node: stackNode,
              onResetZoom: () => setBrushIdx(null), brushActive: !!brushIdx },
            { key: `pnldiv_${poche.key}`, title: "PnL + Dividendes",                node: pnlDivNode,
              onResetZoom: () => setPnlBrushIdx(null), brushActive: !!pnlBrushIdx },
          ]}/>

          <AccordionSection label="Titres" count={enriched.length} color={poche.color}>
            {enriched.length === 0 ? (
              <div className="empty">Aucune position pour le mois sélectionné.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr>
                    <th>Titre</th><th>Ticker</th><th>Sous-cat.</th>
                    <th>Qté</th><th>PRU</th>
                    <th>Investi</th><th>Valeur</th><th>PnL</th><th>Actions</th>
                  </tr></thead>
                  <tbody>{enriched.map(p => (
                    <tr key={p.ticker} style={{ verticalAlign: "middle" }}>
                      <td>{p.nom}</td>
                      <td>
                        <span className="badge" style={{ color: p.color, borderColor: p.color, width: "100%", background: p.color + "22", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 1, lineHeight: 1.3, padding: "4px 7px" }}>
                          <span>{p.ticker}</span>
                          <span style={{ display: "flex", gap: 3, alignItems: "center", fontSize: 9 }}>
                            <span style={{ fontFamily: "var(--mono)", color: "var(--text-1)" }}>{fmt(p.currentPrice)}</span>
                            <span style={{ color: p.pnlPct >= 0 ? "var(--teal)" : "var(--rose)", fontWeight: 700 }}>
                              {p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(2)}%
                            </span>
                          </span>
                        </span>
                      </td>
                      <td><span className="badge b-neutral">{INVEST_SUBCATS.find(s => s.key === p.subcat)?.label ?? p.subcat}</span></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{p.quantite.toFixed(qtyPrec)}</td>
                      <td style={{ color: "var(--text-1)" }}>{fmt(p.pru)}</td>
                      <td>{fmt(p.investTotal)}</td>
                      <td style={{ color: "var(--teal)" }}>{fmt(p.currentValue)}</td>
                      <td className={p.pnl >= 0 ? "pnl-pos" : "pnl-neg"} style={{ verticalAlign: "middle" }}>
                        {p.pnl >= 0 ? "+" : ""}{fmt(p.pnl)}<br/>
                        <span style={{ fontSize: 10 }}>({p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(2)} %)</span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <div style={{ display: "flex", flexDirection: "column" , gap: 4, alignItems: "flex-start" }}>
                            <button className="btn btn-danger btn-sm"
                              onClick={() => setSellTarget({ ticker: p.ticker, nom: p.nom, tickerPositions: positions.filter(pos => pos.ticker === p.ticker), tickerVentes: ventes.filter(v => v.ticker === p.ticker) })}>
                              Vendre
                            </button>
                            {(TRADEABLE_SUBCATS as readonly string[]).includes(p.subcat) && (
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, color: "var(--lavender)", borderColor: "var(--lavender)" }}
                              onClick={() => setTradeTarget({ ticker: p.ticker, nom: p.nom, subcat: p.subcat, tickerPositions: positions.filter(pos => pos.ticker === p.ticker), tickerVentes: ventes.filter(v => v.ticker === p.ticker) })}>
                              Trader
                            </button>
                          )}
                            
                          </div>
                          <button className="btn btn-ghost btn-sm"
                              onClick={() => setDeleteTarget({ ticker: p.ticker, rows: positions.filter(pos => pos.ticker === p.ticker) })}>
                              ✕
                            </button>
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </AccordionSection>

          <AccordionSection label="Dividendes" count={dividendes.length} color="var(--gold)">
            {dividendes.length === 0 ? <div className="empty">Aucun dividende</div> : (
              <table><thead><tr><th>Ticker</th><th>Montant</th><th>Date</th><th></th></tr></thead>
              <tbody>{dividendes.map(d => (
                <tr key={d.id}>
                  <td><span className="badge b-neutral">{d.ticker}</span></td>
                  <td style={{ color: "var(--gold)" }}>{fmt(d.montant)}</td>
                  <td style={{ color: "var(--text-1)" }}>{d.date}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={async () => { await invoke("delete_dividende", { id: d.id }); onRefresh(); }}>✕</button></td>
                </tr>
              ))}</tbody></table>
            )}
          </AccordionSection>

          <AccordionSection label="Versements" count={versements.length}>
            {versements.length === 0 ? <div className="empty">Aucun versement</div> : (
              <table><thead><tr><th>Montant</th><th>Date</th><th>Notes</th><th></th></tr></thead>
              <tbody>{versements.map(v => (
                <tr key={v.id}>
                  <td>{fmt(v.montant)}</td>
                  <td style={{ color: "var(--text-1)" }}>{v.date}</td>
                  <td style={{ color: "var(--text-2)" }}>{v.notes ?? "—"}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={async () => { await invoke("delete_versement", { id: v.id }); onRefresh(); }}>✕</button></td>
                </tr>
              ))}</tbody></table>
            )}
          </AccordionSection>

          <AccordionSection label="Historique ventes" count={ventes.length} color="var(--rose)">
            {ventes.length === 0 ? <div className="empty">Aucune vente</div> : (
              <table><thead><tr><th>Ticker</th><th>Qté</th><th>PRU</th><th>Px vente</th><th>PnL</th><th>Date</th><th></th></tr></thead>
              <tbody>{ventes.map(v => (
                <tr key={v.id}>
                  <td><span className="badge b-neutral">{v.ticker}</span></td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{v.quantite.toFixed(ventPrec)}</td>
                  <td style={{ color: "var(--text-1)" }}>{fmt(v.prix_achat)}</td>
                  <td>{fmt(v.prix_vente)}</td>
                  <td className={v.pnl >= 0 ? "pnl-pos" : "pnl-neg"}>{v.pnl >= 0 ? "+" : ""}{fmt(v.pnl)}</td>
                  <td style={{ color: "var(--text-1)" }}>{v.date_vente}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={async () => { await invoke("delete_vente", { id: v.id }); onRefresh(); }}>✕</button></td>
                </tr>
              ))}</tbody></table>
            )}
          </AccordionSection>
        </div>
      )}

      {posModal    && <PositionModal poche={poche.key} existing={positions} mois={mois} onClose={() => setPosModal(false)}    onSave={() => { setPosModal(false);    onRefresh(); }}/>}
      {divModal    && <DividendeModal poche={poche.key} positions={positions} mois={mois} onClose={() => setDivModal(false)}  onSave={() => { setDivModal(false);    onRefresh(); }}/>}
      {scpiModal && <ScpiValuationModal
        poche={poche.key}
        scpiTickers={[...new Set(positions.filter(p => p.sous_categorie === "scp").map(p => p.ticker))]}
        mois={mois}
        valuations={scpiValuations}
        onClose={() => setScpiModal(false)}
        onSave={() => { invoke<ScpiValuation[]>("get_scpi_valuations", { poche: poche.key }).then(setScpiValuations); }}/>}
      {verModal    && <VersementModal poche={poche.key} mois={mois} onClose={() => setVerModal(false)}                        onSave={() => { setVerModal(false);    onRefresh(); }}/>}
      {sellTarget  && <SellModal  poche={poche.key} {...sellTarget} getPriceForDate={getPriceForDateFull} mois={mois} onClose={() => setSellTarget(null)}  onSave={() => { setSellTarget(null);  onRefresh(); }}/>}
      {tradeTarget && <TradeModal poche={poche.key} {...tradeTarget} tradeablePositions={tradeablePositions} getPriceForDate={getPriceForDateFull} mois={mois} onClose={() => setTradeTarget(null)} onSave={() => { setTradeTarget(null); onRefresh(); }}/>}
      {deleteTarget && <DeletePositionModal {...deleteTarget} onClose={() => setDeleteTarget(null)}                           onSave={() => { setDeleteTarget(null); onRefresh(); }}/>}
    </div>
  );
}
