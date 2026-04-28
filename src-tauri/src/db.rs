use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::api::path::app_data_dir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Depense {
    pub id: Option<i64>, pub date: String, pub categorie: String,
    pub sous_categorie: String, pub libelle: String, pub montant: f64, pub notes: Option<String>,
    pub recurrence_id: Option<i64>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DepenseRecurrente {
    pub id: Option<i64>,
    pub categorie: String,
    pub sous_categorie: String,
    pub libelle: String,
    pub montant: f64,
    pub periodicite: String,  // "mensuel", "annuel", "hebdomadaire"
    pub date_debut: String,
    pub date_fin: Option<String>,
    pub notes: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Salaire {
    pub id: Option<i64>, pub date: String, pub salaire_brut: f64, pub salaire_net: f64,
    pub primes: Option<f64>, pub employeur: String, pub pdf_path: Option<String>, pub notes: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Livret {
    pub id: Option<i64>, pub poche: String, pub nom: String, pub montant: f64, pub taux: f64,
    pub date: String, pub notes: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LivretPoche {
    pub id: Option<i64>,
    pub type_livret: String,
    pub nom: String,
    pub couleur: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Position {
    pub id: Option<i64>, pub poche: String, pub ticker: String, pub nom: String,
    pub sous_categorie: Option<String>, pub quantite: f64, pub prix_achat: f64,
    pub date_achat: String, pub notes: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Vente {
    pub id: Option<i64>, pub poche: String, pub ticker: String, pub nom: String,
    pub quantite: f64, pub prix_achat: f64, pub prix_vente: f64,
    pub date_vente: String, pub pnl: f64, pub notes: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Dividende {
    pub id: Option<i64>, pub position_id: Option<i64>, pub ticker: String,
    pub poche: String, pub montant: f64, pub date: String, pub notes: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Versement {
    pub id: Option<i64>, pub poche: String, pub montant: f64,
    pub date: String, pub notes: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScpiValuation {
    pub id: Option<i64>, pub ticker: String,
    pub mois: String, pub valeur_unit: f64,
}
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Parametre { pub cle: String, pub valeur: String }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ParisPoche {
    pub id: Option<i64>,
    pub nom: String,
    pub couleur: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ParisSelection {
    pub id: Option<i64>,
    pub pari_id: Option<i64>,
    pub categorie: String,
    pub resultat: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Pari {
    pub id: Option<i64>,
    pub poche: String,
    pub date: String,
    pub freebet: bool,
    pub mise: Option<f64>,
    pub cote: f64,
    pub gain: Option<f64>,
    pub statut: String,
    pub notes: Option<String>,
    pub selections: Option<Vec<ParisSelection>>,
}

pub fn get_db_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let config = app_handle.config();
    let mut path = app_data_dir(&config).unwrap_or_else(|| PathBuf::from("."));
    path.push("patrimoine.db");
    path
}

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if version < 1 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS depenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL,
                categorie TEXT NOT NULL, sous_categorie TEXT NOT NULL,
                libelle TEXT NOT NULL, montant REAL NOT NULL, notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS salaires (
                id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL,
                salaire_brut REAL NOT NULL, salaire_net REAL NOT NULL,
                primes REAL DEFAULT 0, employeur TEXT NOT NULL,
                pdf_path TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS livrets (
                id INTEGER PRIMARY KEY AUTOINCREMENT, poche TEXT NOT NULL,
                montant REAL NOT NULL, taux REAL NOT NULL DEFAULT 0,
                date TEXT NOT NULL, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, poche TEXT NOT NULL,
                ticker TEXT NOT NULL, nom TEXT NOT NULL, sous_categorie TEXT,
                quantite REAL NOT NULL, prix_achat REAL NOT NULL,
                date_achat TEXT NOT NULL, notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS parametres (
                cle TEXT PRIMARY KEY, valeur TEXT NOT NULL
            );
            INSERT OR IGNORE INTO parametres (cle, valeur) VALUES
                ('pdf_folder',''),('devise','EUR'),('taux_change','1.0');
            PRAGMA user_version = 1;
        ")?;
    }
    if version < 2 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS ventes (
                id INTEGER PRIMARY KEY AUTOINCREMENT, poche TEXT NOT NULL,
                ticker TEXT NOT NULL, nom TEXT NOT NULL, quantite REAL NOT NULL,
                prix_achat REAL NOT NULL, prix_vente REAL NOT NULL,
                date_vente TEXT NOT NULL, pnl REAL NOT NULL, notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            PRAGMA user_version = 2;
        ")?;
    }
    if version < 3 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS dividendes (
                id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER,
                ticker TEXT NOT NULL, poche TEXT NOT NULL, montant REAL NOT NULL,
                date TEXT NOT NULL, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
            );
            PRAGMA user_version = 3;
        ")?;
    }
    if version < 4 {
        let _ = conn.execute_batch("ALTER TABLE positions ADD COLUMN notes TEXT;");
        let _ = conn.execute_batch("INSERT OR IGNORE INTO parametres (cle,valeur) VALUES ('taux_change','1.0');");
        conn.execute_batch("PRAGMA user_version = 4;")?;
    }
    if version < 5 {
        // Add sous_categorie to positions if missing
        let _ = conn.execute_batch("ALTER TABLE positions ADD COLUMN sous_categorie TEXT;");
        // Add versements table
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS versements (
                id INTEGER PRIMARY KEY AUTOINCREMENT, poche TEXT NOT NULL,
                montant REAL NOT NULL, date TEXT NOT NULL, notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            PRAGMA user_version = 5;
        ")?;
    }
    if version < 6 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS scpi_valuations (
                id INTEGER PRIMARY KEY AUTOINCREMENT, poche TEXT NOT NULL,
                ticker TEXT NOT NULL, mois TEXT NOT NULL, valeur_unit REAL NOT NULL,
                UNIQUE(poche, ticker, mois)
            );
            PRAGMA user_version = 6;
        ")?;
    }
    if version < 7 {
        // Migration : rendre scpi_valuations communes à toutes les poches
        conn.execute_batch("
            CREATE TABLE scpi_valuations_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL, mois TEXT NOT NULL, valeur_unit REAL NOT NULL,
                UNIQUE(ticker, mois)
            );
            INSERT OR IGNORE INTO scpi_valuations_v2 (ticker, mois, valeur_unit)
                SELECT ticker, mois, MAX(valeur_unit) FROM scpi_valuations GROUP BY ticker, mois;
            DROP TABLE scpi_valuations;
            ALTER TABLE scpi_valuations_v2 RENAME TO scpi_valuations;
            PRAGMA user_version = 7;
        ")?;
    }
    if version < 8 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS depenses_recurrentes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                categorie TEXT NOT NULL,
                sous_categorie TEXT NOT NULL,
                libelle TEXT NOT NULL,
                montant REAL NOT NULL,
                periodicite TEXT NOT NULL,
                date_debut TEXT NOT NULL,
                date_fin TEXT,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            ALTER TABLE depenses ADD COLUMN recurrence_id INTEGER;
            PRAGMA user_version = 8;
        ")?;
    }
    if version < 9 {
        // Migration intermédiaire : renommage montant → quantite (jamais appliquée en prod,
        // mais nécessaire pour que le versioning soit cohérent avec les BDs à user_version=9)
        conn.execute_batch("
            CREATE TABLE dividendes_v9 (
                id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER,
                ticker TEXT NOT NULL, poche TEXT NOT NULL, quantite REAL NOT NULL DEFAULT 0,
                date TEXT NOT NULL, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO dividendes_v9 (id, position_id, ticker, poche, quantite, date, notes, created_at)
                SELECT id, position_id, ticker, poche, montant, date, notes, created_at FROM dividendes;
            DROP TABLE dividendes;
            ALTER TABLE dividendes_v9 RENAME TO dividendes;
            PRAGMA user_version = 9;
        ")?;
    }
    if version < 10 {
        // Revert : renommage quantite → montant (retour à l'état d'origine)
        conn.execute_batch("
            CREATE TABLE dividendes_v10 (
                id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER,
                ticker TEXT NOT NULL, poche TEXT NOT NULL, montant REAL NOT NULL DEFAULT 0,
                date TEXT NOT NULL, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO dividendes_v10 (id, position_id, ticker, poche, montant, date, notes, created_at)
                SELECT id, position_id, ticker, poche, quantite, date, notes, created_at FROM dividendes;
            DROP TABLE dividendes;
            ALTER TABLE dividendes_v10 RENAME TO dividendes;
            PRAGMA user_version = 10;
        ")?;
    }
    if version < 11 {
        let _ = conn.execute_batch("ALTER TABLE livrets ADD COLUMN nom TEXT NOT NULL DEFAULT '';");
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS livret_poches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type_livret TEXT NOT NULL,
                nom TEXT NOT NULL,
                taux REAL NOT NULL DEFAULT 0,
                UNIQUE(type_livret, nom)
            );
            PRAGMA user_version = 11;
        ")?;
    }
    if version < 12 {
        let _ = conn.execute_batch("ALTER TABLE livret_poches ADD COLUMN couleur TEXT NOT NULL DEFAULT '';");
        conn.execute_batch("PRAGMA user_version = 12;")?;
    }
    if version < 13 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS paris_poches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nom TEXT NOT NULL UNIQUE,
                couleur TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS paris (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                poche TEXT NOT NULL,
                date TEXT NOT NULL,
                freebet INTEGER NOT NULL DEFAULT 0,
                mise REAL,
                cote REAL NOT NULL DEFAULT 1.0,
                gain REAL,
                statut TEXT NOT NULL DEFAULT 'en_cours',
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS paris_selections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pari_id INTEGER NOT NULL,
                categorie TEXT NOT NULL,
                resultat TEXT NOT NULL DEFAULT 'en_cours',
                FOREIGN KEY(pari_id) REFERENCES paris(id) ON DELETE CASCADE
            );
            PRAGMA user_version = 13;
        ")?;
    }
    Ok(())
}
