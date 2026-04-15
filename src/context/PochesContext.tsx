import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/tauri";

export interface Poche { key: string; label: string; color: string; }

interface PochesCtx {
  poches: Poche[];
  setPoches: (p: Poche[]) => Promise<void>;
  loading: boolean;
}

const Ctx = createContext<PochesCtx>({ poches: [], setPoches: async () => {}, loading: true });

export function PochesProvider({ children }: { children: ReactNode }) {
  const [poches, setPochesState] = useState<Poche[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<string>("get_parametre", { cle: "poches" })
      .then(v => {
        const parsed: Poche[] = JSON.parse(v);
        if (Array.isArray(parsed) && parsed.length > 0) setPochesState(parsed);
      })
      .catch(() => {}) // première exécution : pas encore de valeur
      .finally(() => setLoading(false));
  }, []);

  const setPoches = async (p: Poche[]) => {
    setPochesState(p);
    await invoke("set_parametre", { cle: "poches", valeur: JSON.stringify(p) }).catch(() => {});
  };

  return <Ctx.Provider value={{ poches, setPoches, loading }}>{children}</Ctx.Provider>;
}

export const usePoches = () => useContext(Ctx);
