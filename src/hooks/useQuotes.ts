import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";

export interface Quote {
  ticker: string;
  price: number;
  change: number;
  changePct: number;
  currency: string;
  name: string;
  isHistorical: boolean;
}

// Weekly close price for each month: { "2024-01": 182.5, "2024-02": 185.1, ... }
export type MonthlyPriceMap = Record<string, number>;

// ── Cache ──────────────────────────────────────────────────────────────────────
const LIVE_CACHE:  Record<string, { q: Quote; ts: number }> = {};
const HIST_CACHE:  Record<string, { map: MonthlyPriceMap; ts: number }> = {};
const LIVE_TTL  = 60_000;
const HIST_TTL  = 6 * 3600_000; // 6h pour l'historique

async function rustFetch(url: string): Promise<any> {
  return invoke<any>("fetch_url", { url });
}

// ── Live quote ─────────────────────────────────────────────────────────────────
export async function fetchLiveQuote(ticker: string): Promise<Quote | null> {
  const key = `live_${ticker}`;
  if (LIVE_CACHE[key] && Date.now() - LIVE_CACHE[key].ts < LIVE_TTL)
    return LIVE_CACHE[key].q;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const json = await rustFetch(url);
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const prev = meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPrice ?? 0;
    const cur  = meta.regularMarketPrice ?? 0;
    const q: Quote = {
      ticker, price: cur, name: meta.shortName ?? ticker,
      change: cur - prev,
      changePct: prev > 0 ? ((cur - prev) / prev) * 100 : 0,
      currency: meta.currency ?? "USD", isHistorical: false,
    };
    LIVE_CACHE[key] = { q, ts: Date.now() };
    return q;
  } catch { return null; }
}

// ── Weekly history → monthly close map ────────────────────────────────────────
// Fetches weekly candles from `from` (YYYY-MM) to today and returns
// the last weekly close for each month.
export async function fetchMonthlyPriceMap(
  ticker: string,
  fromMonth: string
): Promise<MonthlyPriceMap> {
  const key = `hist_${ticker}_${fromMonth}`;
  if (HIST_CACHE[key] && Date.now() - HIST_CACHE[key].ts < HIST_TTL)
    return HIST_CACHE[key].map;

  try {
    const [fy, fm] = fromMonth.split("-").map(Number);
    const period1 = Math.floor(new Date(fy, fm - 1, 1).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1wk&period1=${period1}&period2=${period2}`;
    const json = await rustFetch(url);
    const result = json?.chart?.result?.[0];
    if (!result) return {};

    const timestamps: number[] = result.timestamps ?? result.timestamp ?? [];
    const closes: (number|null)[] = result.indicators?.quote?.[0]?.close ?? [];

    // Build map: for each week, record its close under its YYYY-MM key
    // Later week in same month overwrites earlier → last weekly close of month
    const map: MonthlyPriceMap = {};
    timestamps.forEach((ts, i) => {
      const c = closes[i];
      if (!c || c <= 0) return;
      const d = new Date(ts * 1000);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map[mKey] = c; // last write wins → last weekly close of the month
    });

    HIST_CACHE[key] = { map, ts: Date.now() };
    return map;
  } catch { return {}; }
}

// ── Current-month price from live or historical map ────────────────────────────
export function priceForMonth(
  ticker: string,
  month: string,
  histMap: MonthlyPriceMap,
  liveQuote: Quote | null,
  pru: number
): number {
  const curMonth = new Date().toISOString().slice(0, 7);
  if (month >= curMonth && liveQuote) return liveQuote.price;
  if (histMap[month]) return histMap[month];
  // fallback: find nearest previous month in map
  const keys = Object.keys(histMap).filter(k => k <= month).sort();
  if (keys.length) return histMap[keys[keys.length - 1]];
  return pru;
}

// ── Hook: live quotes + full history for a set of tickers ─────────────────────
export function useQuotes(tickers: string[], fromMonth: string) {
  const [liveQuotes, setLiveQuotes] = useState<Record<string, Quote>>({});
  const [histMaps,   setHistMaps]   = useState<Record<string, MonthlyPriceMap>>({});
  const [loading,    setLoading]    = useState(false);
  const key    = [...tickers].sort().join(",");
  const timer  = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!tickers.length) { setLiveQuotes({}); setHistMaps({}); return; }
    setLoading(true);
    try {
      const [lives, hists] = await Promise.all([
        // Live quotes (always)
        Promise.allSettled(tickers.map(t => fetchLiveQuote(t))).then(rs => {
          const out: Record<string, Quote> = {};
          rs.forEach((r, i) => { if (r.status === "fulfilled" && r.value) out[tickers[i]] = r.value; });
          return out;
        }),
        // Historical weekly maps (from first purchase)
        Promise.allSettled(tickers.map(t => fetchMonthlyPriceMap(t, fromMonth))).then(rs => {
          const out: Record<string, MonthlyPriceMap> = {};
          rs.forEach((r, i) => { if (r.status === "fulfilled") out[tickers[i]] = r.value; });
          return out;
        }),
      ]);
      setLiveQuotes(lives);
      setHistMaps(hists);
    } catch {}
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fromMonth]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 60_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  // Convenience: get the right price for any month
  const getPrice = useCallback((ticker: string, month: string, pru = 0): number => {
    const curMonth = new Date().toISOString().slice(0, 7);
    if (month >= curMonth) return liveQuotes[ticker]?.price ?? pru;
    return priceForMonth(ticker, month, histMaps[ticker] ?? {}, liveQuotes[ticker] ?? null, pru);
  }, [liveQuotes, histMaps]);

  // quotes = live quotes (for display in table header)
  const quotes = liveQuotes;

  return { quotes, histMaps, liveQuotes, getPrice, loading, refresh };
}
