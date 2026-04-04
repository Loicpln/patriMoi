import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/tauri";

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

interface DeviseCtx {
  devise: DeviseInfo;
  setDevise: (d: DeviseCode) => void;
  fmt: (n: number) => string;    // 2 décimales
  fmtK: (n: number) => string;   // 2 décimales
}

const Ctx = createContext<DeviseCtx>({
  devise: DEVISES.EUR,
  setDevise: () => {},
  fmt: (n) => `${n.toFixed(2)} €`,
  fmtK: (n) => `${n.toFixed(2)} €`,
});

export function DeviseProvider({ children }: { children: ReactNode }) {
  const [deviseCode, setDeviseCode] = useState<DeviseCode>("EUR");

  useEffect(() => {
    invoke<string>("get_parametre", { cle: "devise" })
      .then(v => { if (v in DEVISES) setDeviseCode(v as DeviseCode); })
      .catch(() => {});
  }, []);

  const devise = DEVISES[deviseCode];

  const fmt = (eur: number) => {
    const val = eur * devise.taux;
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: devise.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const fmtK = fmt; // même format, alias pour rétrocompatibilité

  const handleSet = async (code: DeviseCode) => {
    setDeviseCode(code);
    await invoke("set_parametre", { cle: "devise", valeur: code }).catch(() => {});
  };

  return <Ctx.Provider value={{ devise, setDevise: handleSet, fmt, fmtK }}>{children}</Ctx.Provider>;
}

export const useDevise = () => useContext(Ctx);

// Génère les mois disponibles (24 derniers)
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
