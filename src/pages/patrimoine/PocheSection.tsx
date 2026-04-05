import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceArea,
  ResponsiveContainer, Tooltip, ComposedChart, Bar, Line,
} from "recharts";
import { useDevise, curMonth } from "../../context/DeviseContext";
import { POCHES, INVEST_SUBCATS, INVEST_SUBCAT_COLOR, monthsBetween, tickerColor, tickerColorDim, TOOLTIP_STYLE } from "../../constants";
import { useQuotes } from "../../hooks/useQuotes";
import { ChartGrid, NestedPie, AccordionSection } from "./shared";
import { PositionModal, VersementModal, SellModal, DividendeModal, DeletePositionModal } from "./modals";
import type { Position, Vente, Dividende, Versement } from "./types";
import { SUBCAT_ORDER } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────────
const MN_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

function subcatIdx(key: string) {
  const i = SUBCAT_ORDER.indexOf(key as any);
  return i >= 0 ? i : 99;
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

// Generate weekly dates starting from firstMonth-01, step 7 days, up to today
function genWeekDates(firstMonth: string): string[] {
  const dates: string[] = [];
  const cur = new Date(firstMonth + "-01");
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  while (cur <= now) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 7);
  }
  return dates;
}

// For each event date, find which weekly-point bucket it belongs to
// (latest weekDate <= eventDate)
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

// Build weekly data using actual per-week prices
function buildWeeklyData(
  positions: Position[],
  ventes: Vente[],
  dividendes: Dividende[],
  versements: Versement[],
  getPriceForDate: (ticker: string, dateStr: string, pru?: number) => number,
  allTickers: string[]
): { date: string; month: string; [k: string]: number | string }[] {
  if (!positions.length) return [];

  const allDates = positions.map(p => (p.date_achat ?? "").slice(0, 7)).filter(Boolean).sort();
  const firstMonth = allDates[0];

  // Pre-compute month-level position snapshots — events processed chronologically
  // so buy→sell→rebuy yields the correct PRU for each leg independently.
  const months = monthsBetween(firstMonth, curMonth);
  const monthSnap: Record<string, Record<string, { q: number; inv: number }>> = {};
  {
    type Ev =
      | { date: string; type: "buy"; ticker: string; nom: string; subcat: string; qty: number; price: number }
      | { date: string; type: "sell"; ticker: string; qty: number };
    const allEvents: Ev[] = [
      ...positions.map(p => ({ date: p.date_achat ?? "", type: "buy" as const, ticker: p.ticker, nom: p.nom, subcat: p.sous_categorie ?? "actions", qty: p.quantite, price: p.prix_achat })),
      ...ventes.map(v    => ({ date: v.date_vente ?? "",  type: "sell" as const, ticker: v.ticker, qty: v.quantite })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    const byT: PortfolioMap = {};
    let evIdx = 0;
    months.forEach(m => {
      while (evIdx < allEvents.length && allEvents[evIdx].date.slice(0, 7) <= m) {
        const ev = allEvents[evIdx++];
        if (ev.type === "buy") applyBuy(byT, ev.ticker, ev.nom, ev.subcat, ev.qty, ev.price);
        else                   applySell(byT, ev.ticker, ev.qty);
      }
      // Deep-copy so future mutations don't retroactively change past snapshots
      monthSnap[m] = Object.fromEntries(Object.entries(byT).map(([k, v]) => [k, { ...v }]));
    });
  }

  const weekDates = genWeekDates(firstMonth);

  // Pre-assign per-ticker dividends to weeks
  const divsByWeek: Record<string, Record<string, number>> = {};
  dividendes.forEach(d => {
    const wk = assignToWeek(weekDates, d.date ?? "");
    if (!wk) return;
    if (!divsByWeek[wk]) divsByWeek[wk] = {};
    divsByWeek[wk][d.ticker] = (divsByWeek[wk][d.ticker] ?? 0) + d.montant;
  });

  // Pre-assign per-ticker realized PnL to weeks
  const realByWeek: Record<string, Record<string, number>> = {};
  ventes.forEach(v => {
    const wk = assignToWeek(weekDates, v.date_vente ?? "");
    if (!wk) return;
    if (!realByWeek[wk]) realByWeek[wk] = {};
    realByWeek[wk][v.ticker] = (realByWeek[wk][v.ticker] ?? 0) + v.pnl;
  });

  // Cumulative scans: versements, realized PnL, dividends — all O(n) via sorted pass
  const sortedVers = [...versements].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const sortedVentesChron = [...ventes].sort((a, b) => (a.date_vente ?? "").localeCompare(b.date_vente ?? ""));
  const sortedDivsChron  = [...dividendes].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const cumVersByWeek: Record<string, number> = {};
  const cumPnlByWeek:  Record<string, number> = {};
  const cumDivsByWeek: Record<string, number> = {};
  let cumVers = 0, vIdx = 0;
  let cumPnl  = 0, peIdx = 0;
  let cumDivs = 0, dIdx  = 0;

  weekDates.forEach(wd => {
    while (vIdx  < sortedVers.length        && (sortedVers[vIdx].date           ?? "") <= wd) cumVers += sortedVers[vIdx++].montant;
    while (peIdx < sortedVentesChron.length && (sortedVentesChron[peIdx].date_vente ?? "") <= wd) cumPnl  += sortedVentesChron[peIdx++].pnl;
    while (dIdx  < sortedDivsChron.length   && (sortedDivsChron[dIdx].date      ?? "") <= wd) cumDivs += sortedDivsChron[dIdx++].montant;
    cumVersByWeek[wd] = cumVers;
    cumPnlByWeek[wd]  = cumPnl;
    cumDivsByWeek[wd] = cumDivs;
  });

  return weekDates.map(dateStr => {
    const m = dateStr.slice(0, 7);
    const byT: Record<string, { q: number; inv: number }> = monthSnap[m] ?? {};

    // Portfolio value using actual weekly close price
    const snap: Record<string, number> = {};
    let totalValue = 0, totalInvest = 0;
    Object.entries(byT).forEach(([ticker, d]) => {
      const pru = d.q > 0 ? d.inv / d.q : 0;
      const val = d.q * getPriceForDate(ticker, dateStr, pru);
      snap[ticker] = val;
      totalValue  += val;
      totalInvest += d.inv;
    });

    const pnlLatent = totalValue - totalInvest;

    // Per-ticker PnL latent
    const perTickerPnlLat: Record<string, number> = {};
    Object.entries(byT).forEach(([ticker, d]) => {
      perTickerPnlLat[ticker] = (snap[ticker] ?? 0) - d.inv;
    });

    const weekDivsMap  = divsByWeek[dateStr]  ?? {};
    const weekRealMap  = realByWeek[dateStr]  ?? {};
    const totalDivs    = Object.values(weekDivsMap).reduce((s, v) => s + v, 0);
    const totalReal    = Object.values(weekRealMap).reduce((s, v) => s + v, 0);

    const versTotal  = cumVersByWeek[dateStr] ?? 0;
    const especes    = Math.max(0, versTotal + (cumPnlByWeek[dateStr] ?? 0) + (cumDivsByWeek[dateStr] ?? 0) - totalInvest);
    const lossArea   = Math.max(0, versTotal - (totalValue + especes));
    const pnlTotal   = totalValue + especes - versTotal;

    const row: { date: string; month: string; [k: string]: number | string } = {
      date: dateStr, month: m,
      _especes:    especes,
      ...snap,
      _pnlLatent:  pnlLatent,
      _pnlReal:    totalReal,
      _divs:       totalDivs,
      _versTotal:  versTotal,
      _lossArea:   lossArea,
      _pnlTotal:   pnlTotal,
    };
    allTickers.forEach(ticker => {
      row[`_pnlLat_${ticker}`]  = perTickerPnlLat[ticker] ?? 0;
      row[`_pnlReal_${ticker}`] = weekRealMap[ticker]     ?? 0;
      row[`_divs_${ticker}`]    = weekDivsMap[ticker]     ?? 0;
    });
    return row;
  });
}

// ── Custom colored tooltip ─────────────────────────────────────────────────────
const HIDDEN_KEYS = new Set(["_lossArea", "_pnlTotal"]);

function ColoredTooltip({ active, payload, fmt: fmtFn, label }: any) {
  if (!active || !payload?.length) return null;
  const visible = payload.filter((p: any) => p.value !== 0 && p.value != null && !HIDDEN_KEYS.has(p.dataKey));
  if (!visible.length) return null;

  // Find pnlTotal from hidden payload entry (same data row, just not rendered)
  const pnlEntry = payload.find((p: any) => p.dataKey === "_pnlTotal");
  const pnlTotal: number | null = pnlEntry?.value ?? null;

  return (
    <div style={{ ...TOOLTIP_STYLE, padding: "8px 12px", maxWidth: 280 }}>
      {label && <div style={{ color: "var(--text-2)", fontSize: 9, marginBottom: 6 }}>{label}</div>}
      {visible.map((p: any, i: number) => {
        const isVers = p.dataKey === "_versTotal";
        const pnlColor = pnlTotal != null ? (pnlTotal >= 0 ? "var(--teal)" : "var(--rose)") : undefined;
        return (
          <div key={i} style={{ color: p.color ?? p.stroke ?? "var(--text-0)", fontSize: 11, marginBottom: 2, display: "flex", gap: 8, alignItems: "baseline" }}>
            <span><span style={{ fontWeight: 500 }}>{p.name}</span>: {fmtFn(p.value)}</span>
            {isVers && pnlTotal != null && (
              <span style={{ color: pnlColor, fontSize: 10 }}>
                ({pnlTotal >= 0 ? "+" : ""}{fmtFn(pnlTotal)})
              </span>
            )}
          </div>
        );
      })}
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
  const [sellTarget, setSellTarget]   = useState<{ ticker: string; nom: string; maxQty: number; pru: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ticker: string; rows: Position[] } | null>(null);
  const [pieToggle, setPieToggle] = useState<"capital" | "valeur">("capital");
  const [pnlMode, setPnlMode]     = useState<"latent" | "realise" | "divs">("latent");

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
  const { quotes, getPrice, getPriceForDate, loading, refresh } = useQuotes(tickers, fromMonth);

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

  const chartData = useMemo(() => buildWeeklyData(positions, ventes, dividendes, versements, getPriceForDate, tickers),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [positions, ventes, dividendes, getPriceForDate, tickers]);

  const sortedTickers = useMemo(() => [...allTickers].sort((a, b) => {
    const sa = positions.find(p => p.ticker === a.ticker)?.sous_categorie ?? "";
    const sb = positions.find(p => p.ticker === b.ticker)?.sous_categorie ?? "";
    return subcatIdx(sa) - subcatIdx(sb);
  }), [allTickers, positions]);

  // First date of each month in chartData (for XAxis ticks)
  const xTicks = useMemo(() => {
    const seen = new Set<string>();
    const firsts: string[] = [];
    chartData.forEach((d: any) => {
      const m = (d.date as string).slice(0, 7);
      if (!seen.has(m)) { seen.add(m); firsts.push(d.date as string); }
    });
    const step = Math.max(1, Math.ceil(firsts.length / 8));
    return firsts.filter((_, i) => i % step === 0);
  }, [chartData]);

  // Week-dates inside the selected month (for ReferenceArea highlighting)
  const monthWeekRange = useMemo(() => {
    const inMonth = chartData.filter((d: any) => d.month === mois);
    if (!inMonth.length) return null;
    return { x1: inMonth[0].date as string, x2: inMonth[inMonth.length - 1].date as string };
  }, [chartData, mois]);

  // ── Pie data ──────────────────────────────────────────────────────────────────
  const pieInner = useMemo(() => {
    const map: Record<string, { v: number; c: string }> = {};
    enriched.forEach(p => {
      const val = pieToggle === "capital" ? p.investTotal : p.currentValue;
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
        value: pieToggle === "capital" ? p.investTotal : p.currentValue,
        color: tickerColorDim(p.ticker),
      })),
    ...(especes > 0 ? [{ name: "Espèces", value: especes, color: (INVEST_SUBCAT_COLOR["especes"] ?? "#78909c") + "99" }] : []),
  ].filter(p => p.value > 0), [enriched, pieToggle, especes]);

  const pieTotal = pieToggle === "capital" ? totalInvest : totalValue;

  const summary = [
    { label: "Versements",     value: fmt(totalVers),    color: "var(--text-1)" },
    { label: "Investi",        value: fmt(totalInvest),  color: "var(--text-0)" },
    { label: `Valeur·${mois}`, value: fmt(totalValue),   color: "var(--teal)"   },
    { label: "PnL latent",     value: `${totalPnlOpen >= 0 ? "+" : ""}${fmt(totalPnlOpen)}`, color: totalPnlOpen >= 0 ? "var(--teal)" : "var(--rose)" },
    { label: "PnL réalisé",    value: `${totalPnlReal >= 0 ? "+" : ""}${fmt(totalPnlReal)}`, color: totalPnlReal >= 0 ? "var(--teal)" : "var(--rose)" },
    { label: "Dividendes",     value: fmt(totalDivs),    color: "var(--gold)"   },
    { label: "Espèces",        value: fmt(especes),       color: INVEST_SUBCAT_COLOR["especes"] ?? "#78909c" },
  ];

  // ── Chart nodes ───────────────────────────────────────────────────────────────
  const pieNode = (h: number) => pieInner.length === 0
    ? <div className="empty">Aucune position pour ce mois</div>
    : <NestedPie inner={pieInner} outer={pieOuter} total={pieTotal} fmt={fmt} h={h}
        toggleLabel={pieToggle === "capital" ? "→ Valeur" : "→ Capital"}
        onToggle={() => setPieToggle(v => v === "capital" ? "valeur" : "capital")}/>;

  // Stacked area: value per ticker per week (actual weekly close prices)
  // + red line/fill for cumulative versements (shows loss zone when portfolio < versements)
  const stackNode = (h: number, isExp: boolean) => chartData.length === 0
    ? <div className="empty">Aucune donnée</div>
    : (
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={chartData} margin={{ left: -20 }}>
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
          <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
            tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k€` : `${v}€`} width={45}/>
          {isExp && <Tooltip content={<ColoredTooltip fmt={fmt}/>}/>}
          {monthWeekRange && (
            <ReferenceArea x1={monthWeekRange.x1} x2={monthWeekRange.x2}
              fill="var(--gold)" fillOpacity={0.1}
              stroke="var(--gold)" strokeOpacity={0.5} strokeDasharray="4 2"/>
          )}
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
          {/* Hidden line to carry _pnlTotal into tooltip payload without visual rendering */}
          <Line type="monotone" dataKey="_pnlTotal" name="_pnlTotal"
            stroke="none" strokeWidth={0} dot={false} legendType="none"/>
        </ComposedChart>
      </ResponsiveContainer>
    );

  // PnL + dividendes par ticker, événements assignés à leur semaine exacte
  const pnlDivNode = (h: number, isExp: boolean) => chartData.length === 0
    ? <div className="empty">Aucune donnée</div>
    : (
      <div style={{ height: h, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexShrink: 0 }}>
          {([["latent", "PnL latent"], ["realise", "PnL réalisé"], ["divs", "Dividendes"]] as const).map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${pnlMode === k ? "btn-primary" : "btn-ghost"}`}
              style={{ flex: 1, fontSize: 10 }} onClick={() => setPnlMode(k)}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          <ResponsiveContainer width="100%" height={h - 40}>
            <ComposedChart data={chartData} margin={{ left: pnlMode === "divs" ? 5 : -20 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="date" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
                ticks={xTicks}
                tickFormatter={d => { const mo = parseInt(d.slice(5, 7)); return MN_SHORT[mo - 1]; }}/>
              {pnlMode !== "divs" ? (
                <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
                  tickFormatter={v => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k€` : `${v.toFixed(0)}€`} width={45}/>
              ) : (
                <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
                  tickFormatter={v => v === 0 ? "0€" : Math.abs(v) >= 100 ? `${v.toFixed(0)}€` : `${v.toFixed(2)}€`} width={52}/>
              )}
              {isExp && <Tooltip content={<ColoredTooltip fmt={fmt}/>}/>}
              <ReferenceLine y={0} stroke="var(--border-l)"/>
              {monthWeekRange && (
                <ReferenceArea x1={monthWeekRange.x1} x2={monthWeekRange.x2}
                  fill="var(--gold)" fillOpacity={0.08}
                  stroke="var(--gold)" strokeOpacity={0.4} strokeDasharray="4 2"/>
              )}
              {pnlMode === "latent" && sortedTickers.map(t => (
                <Line key={t.ticker} type="monotone" dataKey={`_pnlLat_${t.ticker}`} name={t.nom}
                  stroke={t.color} strokeWidth={1.5} dot={false}/>
              ))}
              {pnlMode === "realise" && sortedTickers.map(t => (
                <Bar key={t.ticker} dataKey={`_pnlReal_${t.ticker}`} name={t.nom}
                  stackId="r" fill={t.color} radius={[0, 0, 0, 0]}/>
              ))}
              {pnlMode === "divs" && sortedTickers.map(t => (
                <Bar key={t.ticker} dataKey={`_divs_${t.ticker}`} name={t.nom}
                  stackId="d" fill={t.color} radius={[0, 0, 0, 0]}/>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );

  return (
    <div className="table-card" style={{ marginBottom: 12 }}>
      <div className="poche-header" onClick={() => setOpen(v => !v)} style={{ cursor: "pointer", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, transform: open ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform .2s", color: "var(--text-2)" }}>▶</span>
          <span className="poche-title" style={{ color: poche.color }}>{poche.label}</span>
          <span style={{ fontSize: 11, color: "var(--text-1)" }}>
            {fmt(totalInvest)} · <span style={{ color: totalPnlOpen >= 0 ? "var(--teal)" : "var(--rose)" }}>{totalPnlOpen >= 0 ? "+" : ""}{fmt(totalPnlOpen)}</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
          {loading && <span className="spinner"/>}
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setVerModal(true)}>+ Versement</button>
          {positions.length > 0 && <button className="btn btn-teal btn-sm" onClick={() => setDivModal(true)}>+ Dividende</button>}
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
            { key: `stack_${poche.key}`,  title: "Valeur portefeuille / semaine",   node: stackNode  },
            { key: `pnldiv_${poche.key}`, title: "PnL + Dividendes",                node: pnlDivNode },
          ]}/>

          <AccordionSection label="Titres" count={enriched.length} color={poche.color}>
            {enriched.length === 0 ? (
              <div className="empty">Aucune position pour le mois sélectionné.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr>
                    <th>Titre</th><th>Ticker</th><th>Sous-cat.</th>
                    <th>Qté</th><th>PRU</th><th>Px·{mois}</th>
                    <th>Investi</th><th>Valeur</th><th>PnL</th><th>Actions</th>
                  </tr></thead>
                  <tbody>{enriched.map(p => (
                    <tr key={p.ticker} style={{ verticalAlign: "middle" }}>
                      <td>{p.nom}</td>
                      <td>
                        <span className="badge" style={{ color: p.color, borderColor: p.color, background: p.color + "22" }}>{p.ticker}</span>
                        {p.quote && (
                          <span className="quote-pill" style={{ marginLeft: 6 }}>
                            <span className="quote-price">{fmt(p.quote.price)}</span>
                            <span className={`quote-chg ${p.quote.changePct >= 0 ? "pos" : "neg"}`}>
                              {p.quote.changePct >= 0 ? "+" : ""}{p.quote.changePct.toFixed(2)} %
                            </span>
                          </span>
                        )}
                      </td>
                      <td><span className="badge b-neutral">{INVEST_SUBCATS.find(s => s.key === p.subcat)?.label ?? p.subcat}</span></td>
                      <td>{p.quantite.toFixed(4)}</td>
                      <td style={{ color: "var(--text-1)" }}>{fmt(p.pru)}</td>
                      <td>{fmt(p.currentPrice)}</td>
                      <td>{fmt(p.investTotal)}</td>
                      <td style={{ color: "var(--teal)" }}>{fmt(p.currentValue)}</td>
                      <td className={p.pnl >= 0 ? "pnl-pos" : "pnl-neg"} style={{ verticalAlign: "middle" }}>
                        {p.pnl >= 0 ? "+" : ""}{fmt(p.pnl)}<br/>
                        <span style={{ fontSize: 10 }}>({p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(2)} %)</span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn btn-danger btn-sm"
                          onClick={() => setSellTarget({ ticker: p.ticker, nom: p.nom, maxQty: p.quantite, pru: p.pru })}>
                          Vendre
                        </button>{" "}
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => setDeleteTarget({ ticker: p.ticker, rows: positions.filter(pos => pos.ticker === p.ticker) })}>
                          ✕
                        </button>
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
                  <td>{v.quantite.toFixed(4)}</td>
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
      {verModal    && <VersementModal poche={poche.key} mois={mois} onClose={() => setVerModal(false)}                        onSave={() => { setVerModal(false);    onRefresh(); }}/>}
      {sellTarget  && <SellModal poche={poche.key} {...sellTarget} mois={mois} onClose={() => setSellTarget(null)}                        onSave={() => { setSellTarget(null);   onRefresh(); }}/>}
      {deleteTarget && <DeletePositionModal {...deleteTarget} onClose={() => setDeleteTarget(null)}                           onSave={() => { setDeleteTarget(null); onRefresh(); }}/>}
    </div>
  );
}
