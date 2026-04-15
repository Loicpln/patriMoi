// ── Shared types for Patrimoine module ────────────────────────────────────────
export interface Livret    { id?: number; poche: string; montant: number; taux: number; date: string; notes?: string; }
export interface Position  { id?: number; poche: string; ticker: string; nom: string; sous_categorie?: string; quantite: number; prix_achat: number; date_achat: string; notes?: string; }
export interface Vente     { id?: number; poche: string; ticker: string; nom: string; quantite: number; prix_achat: number; prix_vente: number; date_vente: string; pnl: number; notes?: string; }
export interface Dividende { id?: number; ticker: string; poche: string; montant: number; date: string; notes?: string; }
export interface Versement { id?: number; poche: string; montant: number; date: string; notes?: string; }
export interface ScpiValuation { id?: number; ticker: string; mois: string; valeur_unit: number; }

// SUBCAT_ORDER defines stack order from bottom (index 0) to top
export const SUBCAT_ORDER = [
  "fond","scp","private_equity","etc","etf","actions",
  "stable_coin","digital_cash","smart_contract","meme_coin","especes",
] as const;
