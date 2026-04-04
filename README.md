# PatriMoi — Suivi de patrimoine personnel

Application desktop macOS construite avec **Tauri 1 · React · TypeScript · SQLite**.

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| App desktop | Tauri 1 (Rust) |
| UI | React 18 + TypeScript |
| Build | Vite 5 |
| Base de données | SQLite (via rusqlite bundled) |
| Graphiques | Recharts |
| Cours boursiers | Yahoo Finance v8 API (gratuit, sans clé) |
| Style | CSS custom · Playfair Display + JetBrains Mono |

---

## Prérequis

```bash
# 1. Rust (via rustup)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. Node.js >= 18
# Via nvm (recommandé) :
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20 && nvm use 20

# 3. Xcode Command Line Tools (requis pour Tauri sur macOS)
xcode-select --install

# Vérification
rustc --version   # >= 1.70
node --version    # >= 18
```

---

## Installation

```bash
# Depuis le dossier patrimoine-app/
npm install
```

La première compilation Rust (~2-3 min) télécharge et compile les dépendances automatiquement.

---

## Développement

```bash
npm run tauri dev
```

Hot-reload activé : les modifications React sont appliquées instantanément. Les modifications Rust nécessitent un redémarrage.

---

## Build de production

```bash
npm run tauri build
```

Génère un `.app` et un `.dmg` dans `src-tauri/target/release/bundle/`.

---

## Structure du projet

```
patrimoine-app/
│
├── index.html                    # Entrée HTML
├── package.json                  # Dépendances Node
├── vite.config.ts                # Config Vite
├── tsconfig.json                 # Config TypeScript
│
├── src/                          # Frontend React
│   ├── main.tsx                  # Point d'entrée React
│   ├── App.tsx                   # Shell + navigation 5 pages
│   ├── App.css                   # Thème global (dark, Playfair + JetBrains Mono)
│   │
│   ├── hooks/
│   │   └── useQuotes.ts          # Hook Yahoo Finance (refresh auto 60s)
│   │
│   └── pages/
│       ├── Dashboard.tsx         # Vue d'ensemble + taux d'épargne
│       ├── Depenses.tsx          # Dépenses mensuelles par catégorie
│       ├── Fiches.tsx            # Calendrier fiches de paie + PDF
│       ├── Patrimoine.tsx        # Livrets + Investissements + cours live
│       └── Parametres.tsx        # Config dossier PDF
│
└── src-tauri/                    # Backend Rust
    ├── build.rs
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── main.rs               # Point d'entrée Tauri
        ├── db.rs                 # Structures + init SQLite
        └── commands.rs           # 21 commandes invocables depuis React
```

---

## Base de données

Stockée automatiquement dans :
```
~/Library/Application Support/com.patrimo.app/patrimoine.db
```

### Schéma complet

```sql
-- Dépenses mensuelles
CREATE TABLE depenses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,           -- "YYYY-MM-DD"
    categorie       TEXT NOT NULL,           -- "Abonnements", "Santé", etc.
    sous_categorie  TEXT NOT NULL,           -- "Netflix", "Médecin", etc.
    libelle         TEXT NOT NULL,
    montant         REAL NOT NULL,
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Fiches de paie
CREATE TABLE salaires (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT NOT NULL,
    salaire_brut REAL NOT NULL,
    salaire_net  REAL NOT NULL,
    primes       REAL DEFAULT 0,
    employeur    TEXT NOT NULL,
    pdf_path     TEXT,                       -- chemin absolu vers le PDF
    notes        TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
);

-- Livrets réglementés (historique des soldes)
CREATE TABLE livrets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    poche      TEXT NOT NULL,               -- "livret_a" | "ldds" | "lep" | "livret_jeune"
    montant    REAL NOT NULL,
    taux       REAL NOT NULL DEFAULT 0,     -- taux annuel en %
    date       TEXT NOT NULL,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Positions d'investissement
CREATE TABLE positions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    poche       TEXT NOT NULL,              -- "pea" | "av" | "cto" | "crypto"
    ticker      TEXT NOT NULL,             -- symbole Yahoo Finance (ex: "AAPL", "BTC-USD", "WLD.PA")
    nom         TEXT NOT NULL,             -- nom lisible
    quantite    REAL NOT NULL,
    prix_achat  REAL NOT NULL,             -- prix moyen d'achat
    date_achat  TEXT NOT NULL,
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- Dividendes perçus
CREATE TABLE dividendes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER,                   -- référence optionnelle à positions.id
    ticker      TEXT NOT NULL,
    poche       TEXT NOT NULL,
    montant     REAL NOT NULL,             -- montant net perçu en €
    date        TEXT NOT NULL,
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- Paramètres application
CREATE TABLE parametres (
    cle    TEXT PRIMARY KEY,
    valeur TEXT NOT NULL
);
-- Valeurs par défaut : pdf_folder='', devise='EUR'
```

---

## Pages de l'application

### 1. Dashboard
- KPIs : dernier salaire net, dépenses du mois, taux d'épargne calculé, patrimoine total
- Graphique évolution salaire (12 derniers mois)
- Graphique dépenses du mois par catégorie
- Boutons d'accès rapide vers chaque section

### 2. Dépenses
- Sélecteur de mois (24 mois d'historique)
- Bouton `+ Dépense` avec formulaire modal
- Catégories disponibles : Logement, Alimentation, Transport, Loisirs, Santé, Abonnements, Carburant, Autre
- Chaque catégorie a des sous-catégories prédéfinies
- Camembert de répartition par catégorie
- Tableau résumé + tableau détaillé groupé par catégorie > sous-catégorie

### 3. Fiches de paie
- Vue calendrier 4×3 (12 mois) avec sélecteur d'année
- Chaque mois indique : salaire net, primes, indicateur PDF (point vert)
- Clic sur un mois → modal de détail avec tous les chiffres
- Bouton `Ouvrir le PDF` → ouvre avec Aperçu macOS
- Le dossier PDF est configuré dans Paramètres

### 4. Patrimoine

#### Livrets réglementés
- Livret A, LDDS, LEP, Livret Jeune
- Historique des soldes (bouton `+ Mise à jour`)
- Taux configurables par livret
- Camembert de répartition + graphique d'évolution du solde total

#### Investissements (4 poches)
Pour chaque poche (PEA, Assurance Vie, CTO, Wallet Crypto) :
- Tableau des positions avec cours en **temps réel** (Yahoo Finance, refresh auto 60s)
- Pour chaque position : ticker, nom, quantité, prix d'achat, prix actuel, valeur investie, valeur actuelle, PnL (€ et %)
- **3 graphiques** : camembert de répartition, bar chart empilé (investi vs valorisation), bar chart performance (%)
- Dividendes perçus : liste avec total, ajout via modal

### 5. Paramètres
- Sélecteur de dossier natif macOS (via AppleScript)
- Infos sur l'application

---

## Cours boursiers — Tickers Yahoo Finance

| Actif | Ticker exemple |
|-------|---------------|
| Apple | `AAPL` |
| Total Energies (Paris) | `TTE.PA` |
| CAC 40 ETF Amundi | `CW8.PA` |
| Bitcoin | `BTC-USD` |
| Ethereum | `ETH-USD` |
| World ETF (EUR) | `WLD.PA` |
| Or (XAU) | `GC=F` |

Le refresh se fait automatiquement toutes les **60 secondes** quand la page Patrimoine est ouverte.

---

## Commandes Tauri disponibles

| Commande | Description |
|----------|-------------|
| `get_depenses(mois?)` | Liste les dépenses, filtrées par mois si fourni |
| `add_depense(depense)` | Ajoute une dépense |
| `delete_depense(id)` | Supprime une dépense |
| `get_depenses_stats(mois)` | Agrégation par catégorie/sous-catégorie |
| `get_salaires()` | Liste toutes les fiches de paie |
| `add_salaire(salaire)` | Ajoute une fiche |
| `delete_salaire(id)` | Supprime une fiche |
| `open_pdf(path)` | Ouvre un PDF avec l'app macOS par défaut |
| `list_pdf_files(folder)` | Liste les PDF d'un dossier |
| `get_livrets()` | Liste les entrées de livrets |
| `add_livret(livret)` | Ajoute une mise à jour de solde |
| `delete_livret(id)` | Supprime une entrée |
| `get_positions(poche?)` | Liste les positions |
| `add_position(position)` | Ajoute une position |
| `delete_position(id)` | Supprime une position |
| `get_dividendes(poche?)` | Liste les dividendes |
| `add_dividende(dividende)` | Ajoute un dividende |
| `delete_dividende(id)` | Supprime un dividende |
| `get_parametre(cle)` | Lit un paramètre |
| `set_parametre(cle, valeur)` | Écrit un paramètre |
| `choose_folder()` | Ouvre le sélecteur de dossier macOS natif |

---

## Évolutions possibles

- [ ] Export CSV / Excel des dépenses et positions
- [ ] Objectifs d'épargne avec barre de progression
- [ ] Historique des valorisations (snapshots quotidiens)
- [ ] Notifications macOS (rappel mensuel de mise à jour)
- [ ] Import automatique PDF fiches de paie (extraction OCR)
- [ ] Support des devises étrangères
- [ ] Backup chiffré de la base SQLite
- [ ] Graphique en chandelier (candlestick) pour les positions
- [ ] Calcul de la plus-value imposable (PEA, CTO)

---

## Dépannage

**L'app ne compile pas (Rust)**
```bash
rustup update stable
cargo clean  # dans src-tauri/
```

**Yahoo Finance ne répond pas**
- Vérifier que `http` est bien dans `allowlist` dans `tauri.conf.json`
- Le domaine `query1.finance.yahoo.com` doit être dans `scope`

**Le sélecteur de dossier ne s'ouvre pas**
- Vérifier que `shell.execute` est activé dans `tauri.conf.json`
- Sur macOS Ventura+, autoriser l'app dans Confidentialité > Automatisation

**Base de données corrompue**
```bash
rm ~/Library/Application\ Support/com.patrimo.app/patrimoine.db
# Relancer l'app : la DB est recréée automatiquement
```
>>>>>>> 7034e61 (Initial commit)
