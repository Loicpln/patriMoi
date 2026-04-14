import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { fetchPriceMaps, fetchLiveQuote } from "../hooks/useQuotes";

export type DeviseCode = "EUR" | "USD" | "GBP" | "CHF" | "JPY";

interface DeviseInfo {
  code: DeviseCode;
  symbol: string;
  taux: number; // taux de change depuis EUR
}

export const DEVISES: Record<DeviseCode, DeviseInfo> = {
  EUR: { code: "EUR", symbol: "€", taux: 1.00 },
  USD: { code: "USD", symbol: "$", taux: 1.08 },
  GBP: { code: "GBP", symbol: "£", taux: 0.86 },
  CHF: { code: "CHF", symbol: "CHF", taux: 0.97 },
  JPY: { code: "JPY", symbol: "¥", taux: 163.0 },
};

// Yahoo Finance tickers pour EUR→X (nombre d'unités de la devise par 1 €)
const FX_TICKERS: Partial<Record<DeviseCode, string>> = {
  USD: "EURUSD=X",
  GBP: "EURGBP=X",
  CHF: "EURCHF=X",
  JPY: "EURJPY=X",
};

// ── Helpers mois ───────────────────────────────────────────────────────────────
export function getMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    });
  }
  return months;
}

export const MONTHS = getMonths();
export const curMonth = MONTHS[0].value;
export const today = () => new Date().toISOString().slice(0, 10);

// ── Context ────────────────────────────────────────────────────────────────────
interface DeviseCtx {
  devise: DeviseInfo;
  setDevise: (d: DeviseCode) => void;
  fmt: (n: number) => string;
  fmtK: (n: number) => string;
  mois: string;
  setMois: (m: string) => void;
}

const Ctx = createContext<DeviseCtx>({
  devise: DEVISES.EUR,
  setDevise: () => {},
  fmt: (n) => `${n.toFixed(2)} €`,
  fmtK: (n) => `${n.toFixed(2)} €`,
  mois: curMonth,
  setMois: () => {},
});

export function DeviseProvider({ children }: { children: ReactNode }) {
  const [deviseCode, setDeviseCode] = useState<DeviseCode>("EUR");
  const [mois, setMois] = useState(curMonth);
  const [taux, setTaux] = useState(1);

  // Charge la devise persistée
  useEffect(() => {
    invoke<string>("get_parametre", { cle: "devise" })
      .then(v => { if (v in DEVISES) setDeviseCode(v as DeviseCode); })
      .catch(() => {});
  }, []);

  // Récupère le taux de change historique au mois sélectionné
  useEffect(() => {
    if (deviseCode === "EUR") { setTaux(1); return; }
    const fxTicker = FX_TICKERS[deviseCode];
    if (!fxTicker) { setTaux(DEVISES[deviseCode].taux); return; }
    const curM = new Date().toISOString().slice(0, 7);
    if (mois >= curM) {
      fetchLiveQuote(fxTicker)
        .then(q => setTaux(q?.price ?? DEVISES[deviseCode].taux))
        .catch(() => setTaux(DEVISES[deviseCode].taux));
    } else {
      fetchPriceMaps(fxTicker, mois)
        .then(({ monthly }) => {
          const keys = Object.keys(monthly).filter(k => k <= mois).sort();
          setTaux(keys.length ? monthly[keys[keys.length - 1]] : DEVISES[deviseCode].taux);
        })
        .catch(() => setTaux(DEVISES[deviseCode].taux));
    }
  }, [deviseCode, mois]);

  const devise: DeviseInfo = { ...DEVISES[deviseCode], taux };

  const fmt = (eur: number) => {
    const val = eur * taux;
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: deviseCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const fmtK = fmt; // alias pour rétrocompatibilité

  const handleSet = async (code: DeviseCode) => {
    setDeviseCode(code);
    await invoke("set_parametre", { cle: "devise", valeur: code }).catch(() => {});
  };

  return (
    <Ctx.Provider value={{ devise, setDevise: handleSet, fmt, fmtK, mois, setMois }}>
      {children}
    </Ctx.Provider>
  );
}

export const useDevise = () => useContext(Ctx);
