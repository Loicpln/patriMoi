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

// Last weekly close for each month: { "2024-01": 182.5, ... }
export type MonthlyPriceMap = Record<string, number>;

// Weekly close keyed by week-start date: { "2024-01-01": 180.2, ... }
export type WeeklyPriceMap = Record<string, number>;

// ── Cache ──────────────────────────────────────────────────────────────────────
const LIVE_CACHE:  Record<string, { q: Quote; ts: number }> = {};
const HIST_CACHE:  Record<string, { monthly: MonthlyPriceMap; weekly: WeeklyPriceMap; ts: number }> = {};
const LIVE_TTL  = 60_000;
const HIST_TTL  = 6 * 3600_000;

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

// ── Fetch daily candles → build monthly map AND daily map ────────────────────
// monthly: last daily close per month (YYYY-MM → price)
// weekly:  daily close keyed by date (YYYY-MM-DD → price)
//          (field kept as "weekly" for backward-compat with existing consumers)
export async function fetchPriceMaps(
  ticker: string,
  fromMonth: string
): Promise<{ monthly: MonthlyPriceMap; weekly: WeeklyPriceMap }> {
  // "daily" prefix distinguishes from old weekly-interval cache entries
  const key = `hist_daily_${ticker}_${fromMonth}`;
  if (HIST_CACHE[key] && Date.now() - HIST_CACHE[key].ts < HIST_TTL)
    return { monthly: HIST_CACHE[key].monthly, weekly: HIST_CACHE[key].weekly };

  const monthly: MonthlyPriceMap = {};
  const daily:   WeeklyPriceMap  = {};
  try {
    const [fy, fm] = fromMonth.split("-").map(Number);
    const period1 = Math.floor(new Date(fy, fm - 1, 1).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`;
    const json = await rustFetch(url);
    const result = json?.chart?.result?.[0];
    if (result) {
      const timestamps: number[] = result.timestamps ?? result.timestamp ?? [];
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
      timestamps.forEach((ts, i) => {
        const c = closes[i];
        if (!c || c <= 0) return;
        const d = new Date(ts * 1000);
        const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
        const mKey   = dateStr.slice(0, 7);
        monthly[mKey] = c; // last write wins → last daily close of month
        daily[dateStr] = c;
      });
    }
  } catch { /* return empty maps */ }

  HIST_CACHE[key] = { monthly, weekly: daily, ts: Date.now() };
  return { monthly, weekly: daily };
}

// Backward compat
export async function fetchMonthlyPriceMap(ticker: string, fromMonth: string): Promise<MonthlyPriceMap> {
  const { monthly } = await fetchPriceMaps(ticker, fromMonth);
  return monthly;
}

// ── Price helpers ──────────────────────────────────────────────────────────────
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
  const keys = Object.keys(histMap).filter(k => k <= month).sort();
  if (keys.length) return histMap[keys[keys.length - 1]];
  return pru;
}

// Return the weekly close price at or just before `dateStr` (YYYY-MM-DD).
function priceForDate(
  dateStr: string,
  weeklyMap: WeeklyPriceMap,
  monthlyMap: MonthlyPriceMap,
  liveQuote: Quote | null,
  pru: number
): number {
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr >= today && liveQuote) return liveQuote.price;

  // Exact hit in weekly map
  if (weeklyMap[dateStr]) return weeklyMap[dateStr];

  // Most recent weekly candle at or before dateStr
  const wKeys = Object.keys(weeklyMap).filter(k => k <= dateStr).sort();
  if (wKeys.length) return weeklyMap[wKeys[wKeys.length - 1]];

  // Fall back to monthly
  return priceForMonth("", dateStr.slice(0, 7), monthlyMap, liveQuote, pru);
}

// ── USD→EUR conversion ─────────────────────────────────────────────────────────
// Tickers ending with "-USD" are quoted in USD by Yahoo Finance.
// We fetch EURUSD=X (number of USD per 1 EUR) and divide to get the EUR price.
export const FX_TICKER = "EURUSD=X";
export function isUsdTicker(ticker: string): boolean {
  return ticker.trimEnd().toUpperCase().endsWith("-USD");
}

/** Returns the EUR/USD rate at `dateStr` using cached maps, or `fallback` if unavailable. */
export async function eurusdAtDate(dateStr: string): Promise<number> {
  const fromMonth = dateStr.slice(0, 7);
  const [live, maps] = await Promise.all([
    fetchLiveQuote(FX_TICKER),
    fetchPriceMaps(FX_TICKER, fromMonth),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr >= today) return live?.price ?? 1;
  const keys = Object.keys(maps.weekly).filter(k => k <= dateStr).sort();
  if (keys.length) return maps.weekly[keys[keys.length - 1]];
  const mkeys = Object.keys(maps.monthly).filter(k => k <= fromMonth).sort();
  if (mkeys.length) return maps.monthly[mkeys[mkeys.length - 1]];
  return live?.price ?? 1;
}

// ── Hook: live quotes + full history for a set of tickers ─────────────────────
export function useQuotes(tickers: string[], fromMonth: string) {
  const [liveQuotes,    setLiveQuotes]    = useState<Record<string, Quote>>({});
  const [histMaps,      setHistMaps]      = useState<Record<string, MonthlyPriceMap>>({});
  const [histWeekMaps,  setHistWeekMaps]  = useState<Record<string, WeeklyPriceMap>>({});
  const [loading,       setLoading]       = useState(false);
  const key   = [...tickers].sort().join(",");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!tickers.length) { setLiveQuotes({}); setHistMaps({}); setHistWeekMaps({}); return; }
    setLoading(true);
    // Include EURUSD=X whenever any ticker is USD-quoted
    const needsFx  = tickers.some(isUsdTicker);
    const allTicks = needsFx ? [...new Set([...tickers, FX_TICKER])] : tickers;
    try {
      const [lives, maps] = await Promise.all([
        Promise.allSettled(allTicks.map(t => fetchLiveQuote(t))).then(rs => {
          const out: Record<string, Quote> = {};
          rs.forEach((r, i) => { if (r.status === "fulfilled" && r.value) out[allTicks[i]] = r.value; });
          return out;
        }),
        Promise.allSettled(allTicks.map(t => fetchPriceMaps(t, fromMonth))).then(rs => {
          const monthly: Record<string, MonthlyPriceMap> = {};
          const weekly:  Record<string, WeeklyPriceMap>  = {};
          rs.forEach((r, i) => {
            if (r.status === "fulfilled") {
              monthly[allTicks[i]] = r.value.monthly;
              weekly[allTicks[i]]  = r.value.weekly;
            }
          });
          return { monthly, weekly };
        }),
      ]);
      setLiveQuotes(lives);
      setHistMaps(maps.monthly);
      setHistWeekMaps(maps.weekly);
    } catch {}
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fromMonth]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 60_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  // getPrice: price for a given YYYY-MM, converted to EUR when ticker is USD-quoted
  const getPrice = useCallback((ticker: string, month: string, pru = 0): number => {
    const curMonth = new Date().toISOString().slice(0, 7);
    const raw = month >= curMonth
      ? (liveQuotes[ticker]?.price ?? pru)
      : priceForMonth(ticker, month, histMaps[ticker] ?? {}, liveQuotes[ticker] ?? null, pru);
    if (!isUsdTicker(ticker)) return raw;
    const fxRate = month >= curMonth
      ? (liveQuotes[FX_TICKER]?.price ?? 1)
      : priceForMonth(FX_TICKER, month, histMaps[FX_TICKER] ?? {}, liveQuotes[FX_TICKER] ?? null, 1);
    return fxRate > 0 ? raw / fxRate : raw;
  }, [liveQuotes, histMaps]);

  // getPriceForDate: price at (or just before) a YYYY-MM-DD date, converted to EUR when needed
  const getPriceForDate = useCallback((ticker: string, dateStr: string, pru = 0): number => {
    const raw = priceForDate(
      dateStr,
      histWeekMaps[ticker] ?? {},
      histMaps[ticker] ?? {},
      liveQuotes[ticker] ?? null,
      pru,
    );
    if (!isUsdTicker(ticker)) return raw;
    const fxRate = priceForDate(
      dateStr,
      histWeekMaps[FX_TICKER] ?? {},
      histMaps[FX_TICKER] ?? {},
      liveQuotes[FX_TICKER] ?? null,
      1,
    );
    return fxRate > 0 ? raw / fxRate : raw;
  }, [liveQuotes, histMaps, histWeekMaps]);

  const quotes = liveQuotes;
  return { quotes, histMaps, histWeekMaps, liveQuotes, getPrice, getPriceForDate, loading, refresh };
}
