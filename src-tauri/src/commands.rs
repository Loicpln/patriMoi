use rusqlite::params;
use std::sync::Mutex;
use tauri::State;
use crate::db::*;

pub struct DbState(pub Mutex<rusqlite::Connection>);

// ═══ DÉPENSES ═══════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_depenses(mois: Option<String>, state: State<DbState>) -> Result<Vec<Depense>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (sql, filtered) = match &mois {
        Some(_) => ("SELECT id,date,categorie,sous_categorie,libelle,montant,notes FROM depenses WHERE strftime('%Y-%m',date)=?1 ORDER BY date DESC", true),
        None    => ("SELECT id,date,categorie,sous_categorie,libelle,montant,notes FROM depenses ORDER BY date DESC", false),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| Ok(Depense { id:r.get(0)?,date:r.get(1)?,categorie:r.get(2)?,sous_categorie:r.get(3)?,libelle:r.get(4)?,montant:r.get(5)?,notes:r.get(6)? });
    let items = if filtered { stmt.query_map(params![mois.unwrap()], map) } else { stmt.query_map([], map) }
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_depense(depense: Depense, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO depenses (date,categorie,sous_categorie,libelle,montant,notes) VALUES (?1,?2,?3,?4,?5,?6)",
        params![depense.date,depense.categorie,depense.sous_categorie,depense.libelle,depense.montant,depense.notes])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn update_depense(depense: Depense, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE depenses SET date=?1,categorie=?2,sous_categorie=?3,libelle=?4,montant=?5,notes=?6 WHERE id=?7",
        params![depense.date,depense.categorie,depense.sous_categorie,depense.libelle,depense.montant,depense.notes,depense.id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn delete_depense(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM depenses WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ═══ SALAIRES ════════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_salaires(state: State<DbState>) -> Result<Vec<Salaire>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id,date,salaire_brut,salaire_net,primes,employeur,pdf_path,notes FROM salaires ORDER BY date DESC").map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |r| Ok(Salaire{id:r.get(0)?,date:r.get(1)?,salaire_brut:r.get(2)?,salaire_net:r.get(3)?,primes:r.get(4)?,employeur:r.get(5)?,pdf_path:r.get(6)?,notes:r.get(7)?}))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_salaire(salaire: Salaire, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO salaires (date,salaire_brut,salaire_net,primes,employeur,pdf_path,notes) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![salaire.date,salaire.salaire_brut,salaire.salaire_net,salaire.primes,salaire.employeur,salaire.pdf_path,salaire.notes])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn update_salaire(salaire: Salaire, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE salaires SET date=?1,salaire_brut=?2,salaire_net=?3,primes=?4,employeur=?5,pdf_path=?6,notes=?7 WHERE id=?8",
        params![salaire.date,salaire.salaire_brut,salaire.salaire_net,salaire.primes,salaire.employeur,salaire.pdf_path,salaire.notes,salaire.id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn delete_salaire(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM salaires WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn open_pdf(path: String) -> Result<(), String> {
    std::process::Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn list_pdf_files(folder: String) -> Result<Vec<serde_json::Value>, String> {
    let path = std::path::Path::new(&folder);
    if !path.exists() { return Ok(vec![]); }
    let mut files = vec![];
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let p = entry.map_err(|e| e.to_string())?.path();
        if p.extension().and_then(|e| e.to_str()) == Some("pdf") {
            files.push(serde_json::json!({"name":p.file_name().unwrap_or_default().to_string_lossy(),"path":p.to_string_lossy()}));
        }
    }
    files.sort_by(|a,b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    Ok(files)
}

// ═══ LIVRETS ═════════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_livrets(state: State<DbState>) -> Result<Vec<Livret>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id,poche,montant,taux,date,notes FROM livrets ORDER BY date DESC").map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |r| Ok(Livret{id:r.get(0)?,poche:r.get(1)?,montant:r.get(2)?,taux:r.get(3)?,date:r.get(4)?,notes:r.get(5)?}))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_livret(livret: Livret, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO livrets (poche,montant,taux,date,notes) VALUES (?1,?2,?3,?4,?5)",
        params![livret.poche,livret.montant,livret.taux,livret.date,livret.notes]).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn delete_livret(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM livrets WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ═══ POSITIONS ════════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_positions(poche: Option<String>, state: State<DbState>) -> Result<Vec<Position>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (sql, filtered) = match &poche {
        Some(_) => ("SELECT id,poche,ticker,nom,sous_categorie,quantite,prix_achat,date_achat,notes FROM positions WHERE poche=?1 ORDER BY date_achat ASC", true),
        None    => ("SELECT id,poche,ticker,nom,sous_categorie,quantite,prix_achat,date_achat,notes FROM positions ORDER BY date_achat ASC", false),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| Ok(Position{id:r.get(0)?,poche:r.get(1)?,ticker:r.get(2)?,nom:r.get(3)?,sous_categorie:r.get(4)?,quantite:r.get(5)?,prix_achat:r.get(6)?,date_achat:r.get(7)?,notes:r.get(8)?});
    let items = if filtered { stmt.query_map(params![poche.unwrap()], map) } else { stmt.query_map([], map) }
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_position(position: Position, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO positions (poche,ticker,nom,sous_categorie,quantite,prix_achat,date_achat,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![position.poche,position.ticker,position.nom,position.sous_categorie,position.quantite,position.prix_achat,position.date_achat,position.notes])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn delete_position(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM positions WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ═══ VENTES ══════════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_ventes(poche: Option<String>, state: State<DbState>) -> Result<Vec<Vente>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (sql, filtered) = match &poche {
        Some(_) => ("SELECT id,poche,ticker,nom,quantite,prix_achat,prix_vente,date_vente,pnl,notes FROM ventes WHERE poche=?1 ORDER BY date_vente DESC", true),
        None    => ("SELECT id,poche,ticker,nom,quantite,prix_achat,prix_vente,date_vente,pnl,notes FROM ventes ORDER BY date_vente DESC", false),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| Ok(Vente{id:r.get(0)?,poche:r.get(1)?,ticker:r.get(2)?,nom:r.get(3)?,quantite:r.get(4)?,prix_achat:r.get(5)?,prix_vente:r.get(6)?,date_vente:r.get(7)?,pnl:r.get(8)?,notes:r.get(9)?});
    let items = if filtered { stmt.query_map(params![poche.unwrap()], map) } else { stmt.query_map([], map) }
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn sell_position(poche: String, ticker: String, nom: String, quantite_vendue: f64, prix_vente: f64, date_vente: String, notes: Option<String>, state: State<DbState>) -> Result<f64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // ── Fetch all buy lots ────────────────────────────────────────────────────
    let mut stmt = conn.prepare(
        "SELECT quantite,prix_achat,date_achat FROM positions \
         WHERE poche=?1 AND ticker=?2 ORDER BY date_achat ASC"
    ).map_err(|e| e.to_string())?;
    let buy_rows: Vec<(f64,f64,String)> = stmt
        .query_map(params![poche,ticker], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;

    // ── Fetch all previous sells for this ticker ──────────────────────────────
    let mut stmt2 = conn.prepare(
        "SELECT quantite,date_vente FROM ventes \
         WHERE poche=?1 AND ticker=?2 ORDER BY date_vente ASC"
    ).map_err(|e| e.to_string())?;
    let sell_rows: Vec<(f64,String)> = stmt2
        .query_map(params![poche,ticker], |r| Ok((r.get(0)?,r.get(1)?)))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;

    // ── Replay buys and sells chronologically to obtain current PRU ───────────
    // Each event: (date, is_buy, qty, unit_price)
    let mut events: Vec<(String, bool, f64, f64)> = Vec::new();
    for (qty, price, date) in &buy_rows  { events.push((date.clone(), true,  *qty, *price)); }
    for (qty, date)         in &sell_rows { events.push((date.clone(), false, *qty, 0.0)); }
    events.sort_by(|a, b| a.0.cmp(&b.0));

    let mut cur_q: f64   = 0.0;
    let mut cur_inv: f64 = 0.0;
    for (_, is_buy, qty, price) in &events {
        if *is_buy {
            cur_q   += qty;
            cur_inv += qty * price;
        } else {
            let pru_at_sell = if cur_q > 1e-12 { cur_inv / cur_q } else { 0.0 };
            cur_q   = (cur_q   - qty).max(0.0);
            cur_inv = (cur_inv - qty * pru_at_sell).max(0.0);
        }
    }

    // cur_q is the quantity still available after all previous sells
    if quantite_vendue > cur_q + 1e-9 {
        return Err(format!("Quantité vendue ({:.4}) > disponible ({:.4})", quantite_vendue, cur_q));
    }

    // PRU of the remaining (currently held) shares
    let pru: f64 = if cur_q > 1e-12 { cur_inv / cur_q } else { 0.0 };
    let pnl = ((prix_vente - pru) * quantite_vendue * 1e10).round() / 1e10;

    conn.execute(
        "INSERT INTO ventes (poche,ticker,nom,quantite,prix_achat,prix_vente,date_vente,pnl,notes) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![poche,ticker,nom,quantite_vendue,pru,prix_vente,date_vente,pnl,notes]
    ).map_err(|e| e.to_string())?;
    // Positions are kept intact for historical tracking.
    // The frontend aggregates positions and deducts ventes for the selected month.
    Ok(pnl)
}
#[tauri::command]
pub fn delete_vente(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ventes WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ═══ DIVIDENDES ══════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_dividendes(poche: Option<String>, state: State<DbState>) -> Result<Vec<Dividende>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (sql, filtered) = match &poche {
        Some(_) => ("SELECT id,position_id,ticker,poche,montant,date,notes FROM dividendes WHERE poche=?1 ORDER BY date DESC", true),
        None    => ("SELECT id,position_id,ticker,poche,montant,date,notes FROM dividendes ORDER BY date DESC", false),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| Ok(Dividende{id:r.get(0)?,position_id:r.get(1)?,ticker:r.get(2)?,poche:r.get(3)?,montant:r.get(4)?,date:r.get(5)?,notes:r.get(6)?});
    let items = if filtered { stmt.query_map(params![poche.unwrap()], map) } else { stmt.query_map([], map) }
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_dividende(dividende: Dividende, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO dividendes (position_id,ticker,poche,montant,date,notes) VALUES (?1,?2,?3,?4,?5,?6)",
        params![dividende.position_id,dividende.ticker,dividende.poche,dividende.montant,dividende.date,dividende.notes])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn delete_dividende(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM dividendes WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ═══ VERSEMENTS ══════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_versements(poche: Option<String>, state: State<DbState>) -> Result<Vec<Versement>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (sql, filtered) = match &poche {
        Some(_) => ("SELECT id,poche,montant,date,notes FROM versements WHERE poche=?1 ORDER BY date DESC", true),
        None    => ("SELECT id,poche,montant,date,notes FROM versements ORDER BY date DESC", false),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| Ok(Versement{id:r.get(0)?,poche:r.get(1)?,montant:r.get(2)?,date:r.get(3)?,notes:r.get(4)?});
    let items = if filtered { stmt.query_map(params![poche.unwrap()], map) } else { stmt.query_map([], map) }
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_versement(versement: Versement, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO versements (poche,montant,date,notes) VALUES (?1,?2,?3,?4)",
        params![versement.poche,versement.montant,versement.date,versement.notes])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn delete_versement(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM versements WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ═══ SCPI VALUATIONS ═════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_scpi_valuations(poche: Option<String>, state: State<DbState>) -> Result<Vec<ScpiValuation>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (sql, filtered) = match &poche {
        Some(_) => ("SELECT id,poche,ticker,mois,valeur_unit FROM scpi_valuations WHERE poche=?1 ORDER BY mois DESC", true),
        None    => ("SELECT id,poche,ticker,mois,valeur_unit FROM scpi_valuations ORDER BY mois DESC", false),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| Ok(ScpiValuation{id:r.get(0)?,poche:r.get(1)?,ticker:r.get(2)?,mois:r.get(3)?,valeur_unit:r.get(4)?});
    let items = if filtered { stmt.query_map(params![poche.unwrap()], map) } else { stmt.query_map([], map) }
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_scpi_valuation(val: ScpiValuation, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO scpi_valuations (poche,ticker,mois,valeur_unit) VALUES (?1,?2,?3,?4) ON CONFLICT(poche,ticker,mois) DO UPDATE SET valeur_unit=excluded.valeur_unit",
        params![val.poche,val.ticker,val.mois,val.valeur_unit])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn delete_scpi_valuation(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM scpi_valuations WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ═══ PARAMÈTRES ══════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_parametre(cle: String, state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT valeur FROM parametres WHERE cle=?1", params![cle], |r| r.get(0)).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn set_parametre(cle: String, valeur: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO parametres (cle,valeur) VALUES (?1,?2)", params![cle,valeur]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn choose_folder() -> Result<String, String> {
    let output = std::process::Command::new("osascript")
        .args(["-e","POSIX path of (choose folder with prompt \"Sélectionner le dossier des fiches de paie\")"])
        .output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8(output.stdout).map_err(|e| e.to_string())?.trim().to_string())
}

/// Opens a folder picker, creates a dated subfolder (YYYY-MM-DD) inside it, and returns its path.
/// The JS side can then write files directly into the returned path.
#[tauri::command]
pub fn choose_export_folder() -> Result<String, String> {
    let output = std::process::Command::new("osascript")
        .args(["-e","POSIX path of (choose folder with prompt \"Choisir le dossier de destination pour l'export\")"])
        .output().map_err(|e| e.to_string())?;
    let parent = String::from_utf8(output.stdout).map_err(|e| e.to_string())?.trim().to_string();
    if parent.is_empty() {
        return Ok(String::new()); // user cancelled
    }
    // Build date string YYYY-MM-DD
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let days = now / 86400;
    let (y, m, d) = days_to_ymd(days as i64);
    let date_str = format!("{:04}-{:02}-{:02}", y, m, d);
    // Strip trailing slash from parent
    let parent = parent.trim_end_matches('/');
    let subfolder = format!("{}/{}", parent, date_str);
    std::fs::create_dir_all(&subfolder).map_err(|e| format!("Impossible de créer le dossier '{}': {}", subfolder, e))?;
    Ok(subfolder)
}

/// Gregorian calendar: convert days-since-epoch to (year, month, day).
fn days_to_ymd(z: i64) -> (i64, u8, u8) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u8, d as u8)
}

/// Reads all tables from the DB and writes CSV files into `subfolder`.
/// Returns the list of filenames written.
#[tauri::command]
pub fn export_all_csv(subfolder: String, state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let dir = std::path::Path::new(&subfolder);
    let mut written: Vec<String> = Vec::new();

    fn esc(v: &str) -> String {
        if v.contains(',') || v.contains('"') || v.contains('\n') {
            format!("\"{}\"", v.replace('"', "\"\""))
        } else { v.to_string() }
    }
    fn row(fields: &[String]) -> String { fields.iter().map(|f| esc(f)).collect::<Vec<_>>().join(",") }
    fn write_csv(dir: &std::path::Path, name: &str, header: &str, lines: Vec<String>) -> Result<(), String> {
        let path = dir.join(name);
        let mut content = "\u{FEFF}".to_string(); // BOM
        content.push_str(header);
        content.push('\n');
        for l in lines { content.push_str(&l); content.push('\n'); }
        std::fs::write(&path, content).map_err(|e| format!("{}: {}", name, e))
    }

    // ── Dépenses ──────────────────────────────────────────────────────────
    {
        let mut stmt = conn.prepare("SELECT id,date,categorie,sous_categorie,libelle,montant,notes FROM depenses ORDER BY date DESC").map_err(|e| e.to_string())?;
        let lines: Vec<String> = stmt.query_map([], |r| {
            let id: Option<i64> = r.get(0)?; let montant: f64 = r.get(5)?;
            Ok(vec![id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,format!("{:.2}",montant),r.get::<_,Option<String>>(6)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?.filter_map(|r|r.ok()).map(|f|row(&f)).collect();
        write_csv(dir,"depenses.csv","id,date,categorie,sous_categorie,libelle,montant,notes",lines)?;
        written.push("depenses.csv".into());
    }

    // ── Salaires ──────────────────────────────────────────────────────────
    {
        let mut stmt = conn.prepare("SELECT id,date,salaire_brut,salaire_net,primes,employeur,notes FROM salaires ORDER BY date DESC").map_err(|e|e.to_string())?;
        let lines: Vec<String> = stmt.query_map([],|r|{
            let id:Option<i64>=r.get(0)?; let brut:f64=r.get(2)?; let net:f64=r.get(3)?;
            let primes:Option<f64>=r.get(4)?; let emp:String=r.get(5)?; let notes:Option<String>=r.get(6)?;
            let is_prime=emp=="_PRIME";
            let notes_str=notes.clone().unwrap_or_default();
            let type_str=if is_prime {
                let re=notes_str.find('[').and_then(|_|notes_str.find(']')).map(|e|notes_str[7..e].to_string()).unwrap_or("Prime".into());
                re
            } else {"Fiche de paie".into()};
            let notes_clean=if is_prime { let s=&notes_str; let end=s.find("] ").map(|i|i+2).unwrap_or(0); s[end..].to_string() } else { notes_str };
            Ok(vec![id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,type_str,format!("{:.2}",brut),format!("{:.2}",net),primes.map_or("".into(),|v|format!("{:.2}",v)),if is_prime{"".into()}else{emp},notes_clean])
        }).map_err(|e|e.to_string())?.filter_map(|r|r.ok()).map(|f|row(&f)).collect();
        write_csv(dir,"fiches_et_primes.csv","id,date,type,salaire_brut,salaire_net,primes,employeur,notes",lines)?;
        written.push("fiches_et_primes.csv".into());
    }

    // ── Livrets ───────────────────────────────────────────────────────────
    {
        let mut stmt = conn.prepare("SELECT id,poche,date,montant,taux,notes FROM livrets ORDER BY date DESC").map_err(|e|e.to_string())?;
        let lines: Vec<String> = stmt.query_map([],|r|{
            let id:Option<i64>=r.get(0)?; let montant:f64=r.get(3)?; let taux:f64=r.get(4)?;
            Ok(vec![id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,format!("{:.2}",montant),format!("{}",taux),r.get::<_,Option<String>>(5)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?.filter_map(|r|r.ok()).map(|f|row(&f)).collect();
        write_csv(dir,"livrets.csv","id,poche,date,montant,taux,notes",lines)?;
        written.push("livrets.csv".into());
    }

    // ── Poches ────────────────────────────────────────────────────────────
    let poche_header="type,id,date,ticker,nom,sous_categorie,quantite,prix_achat,prix_vente,pnl,montant,notes";
    for poche_key in &["pea","av","cto","crypto"] {
        let _filename = match *poche_key { "av" => "assurance_vie.csv", _ => &format!("{}.csv",poche_key) };
        let _filename = match *poche_key { "av" => "assurance_vie.csv".to_string(), k => format!("{}.csv",k) };
        let mut lines: Vec<String> = Vec::new();
        // Positions
        let mut stmt=conn.prepare("SELECT id,date_achat,ticker,nom,sous_categorie,quantite,prix_achat,notes FROM positions WHERE poche=?1 ORDER BY date_achat").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([poche_key],|r|{
            let id:Option<i64>=r.get(0)?; let qty:f64=r.get(5)?; let px:f64=r.get(6)?;
            Ok(vec!["Position".into(),id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?.unwrap_or_default(),format!("{}",qty),format!("{}",px),"".into(),"".into(),"".into(),r.get::<_,Option<String>>(7)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e|e.to_string())?)); }
        // Ventes
        let mut stmt=conn.prepare("SELECT id,date_vente,ticker,nom,quantite,prix_achat,prix_vente,pnl,notes FROM ventes WHERE poche=?1 ORDER BY date_vente").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([poche_key],|r|{
            let id:Option<i64>=r.get(0)?; let qty:f64=r.get(4)?; let pa:f64=r.get(5)?; let pv:f64=r.get(6)?; let pnl:f64=r.get(7)?;
            Ok(vec!["Vente".into(),id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,String::new(),format!("{}",qty),format!("{}",pa),format!("{}",pv),format!("{}",pnl),String::new(),r.get::<_,Option<String>>(8)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e|e.to_string())?)); }
        // Dividendes
        let mut stmt=conn.prepare("SELECT id,date,ticker,montant,notes FROM dividendes WHERE poche=?1 ORDER BY date").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([poche_key],|r|{
            let id:Option<i64>=r.get(0)?; let m:f64=r.get(3)?;
            Ok(vec!["Dividende".into(),id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,String::new(),String::new(),String::new(),String::new(),String::new(),String::new(),format!("{}",m),r.get::<_,Option<String>>(4)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e|e.to_string())?)); }
        // Versements
        let mut stmt=conn.prepare("SELECT id,date,montant,notes FROM versements WHERE poche=?1 ORDER BY date").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([poche_key],|r|{
            let id:Option<i64>=r.get(0)?; let m:f64=r.get(2)?;
            Ok(vec!["Versement".into(),id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,String::new(),String::new(),String::new(),String::new(),String::new(),String::new(),String::new(),format!("{}",m),r.get::<_,Option<String>>(3)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e|e.to_string())?)); }
        write_csv(dir,&_filename,poche_header,lines)?;
        written.push(_filename);
    }

    // ── SCPI ──────────────────────────────────────────────────────────────
    {
        let mut stmt=conn.prepare("SELECT id,poche,ticker,mois,valeur_unit FROM scpi_valuations ORDER BY poche,ticker,mois").map_err(|e|e.to_string())?;
        let lines:Vec<String>=stmt.query_map([],|r|{
            let id:Option<i64>=r.get(0)?; let v:f64=r.get(4)?;
            Ok(vec![id.map_or("".into(),|x|x.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,format!("{}",v)])
        }).map_err(|e|e.to_string())?.filter_map(|r|r.ok()).map(|f|row(&f)).collect();
        write_csv(dir,"scpi_valorisations.csv","id,poche,ticker,mois,valeur_unit",lines)?;
        written.push("scpi_valorisations.csv".into());
    }

    Ok(written)
}

// ═══ IMPORT ══════════════════════════════════════════════════════════════════
#[tauri::command]
pub fn import_depenses(rows: Vec<Depense>, replace: bool, state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if replace { conn.execute("DELETE FROM depenses", []).map_err(|e| e.to_string())?; }
    for r in &rows {
        conn.execute("INSERT INTO depenses (date,categorie,sous_categorie,libelle,montant,notes) VALUES (?1,?2,?3,?4,?5,?6)",
            params![r.date,r.categorie,r.sous_categorie,r.libelle,r.montant,r.notes])
            .map_err(|e| e.to_string())?;
    }
    Ok(rows.len())
}

#[tauri::command]
pub fn import_salaires(rows: Vec<Salaire>, replace: bool, state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if replace { conn.execute("DELETE FROM salaires", []).map_err(|e| e.to_string())?; }
    for r in &rows {
        conn.execute("INSERT INTO salaires (date,salaire_brut,salaire_net,primes,employeur,pdf_path,notes) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![r.date,r.salaire_brut,r.salaire_net,r.primes,r.employeur,r.pdf_path,r.notes])
            .map_err(|e| e.to_string())?;
    }
    Ok(rows.len())
}

#[tauri::command]
pub fn import_livrets(rows: Vec<Livret>, replace: bool, state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if replace { conn.execute("DELETE FROM livrets", []).map_err(|e| e.to_string())?; }
    for r in &rows {
        conn.execute("INSERT INTO livrets (poche,montant,taux,date,notes) VALUES (?1,?2,?3,?4,?5)",
            params![r.poche,r.montant,r.taux,r.date,r.notes])
            .map_err(|e| e.to_string())?;
    }
    Ok(rows.len())
}

#[tauri::command]
pub fn import_poche(
    poche: String,
    positions: Vec<Position>,
    ventes: Vec<Vente>,
    dividendes: Vec<Dividende>,
    versements: Vec<Versement>,
    replace: bool,
    state: State<DbState>,
) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if replace {
        conn.execute("DELETE FROM positions WHERE poche=?1", params![poche]).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ventes WHERE poche=?1", params![poche]).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM dividendes WHERE poche=?1", params![poche]).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM versements WHERE poche=?1", params![poche]).map_err(|e| e.to_string())?;
    }
    let mut count = 0usize;
    for r in &positions {
        conn.execute("INSERT INTO positions (poche,ticker,nom,sous_categorie,quantite,prix_achat,date_achat,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![poche,r.ticker,r.nom,r.sous_categorie,r.quantite,r.prix_achat,r.date_achat,r.notes])
            .map_err(|e| e.to_string())?;
        count += 1;
    }
    for r in &ventes {
        conn.execute("INSERT INTO ventes (poche,ticker,nom,quantite,prix_achat,prix_vente,date_vente,pnl,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![poche,r.ticker,r.nom,r.quantite,r.prix_achat,r.prix_vente,r.date_vente,r.pnl,r.notes])
            .map_err(|e| e.to_string())?;
        count += 1;
    }
    for r in &dividendes {
        conn.execute("INSERT INTO dividendes (position_id,ticker,poche,montant,date,notes) VALUES (?1,?2,?3,?4,?5,?6)",
            params![r.position_id,r.ticker,poche,r.montant,r.date,r.notes])
            .map_err(|e| e.to_string())?;
        count += 1;
    }
    for r in &versements {
        conn.execute("INSERT INTO versements (poche,montant,date,notes) VALUES (?1,?2,?3,?4)",
            params![poche,r.montant,r.date,r.notes])
            .map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
pub fn import_scpi_valuations(rows: Vec<ScpiValuation>, replace: bool, state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if replace { conn.execute("DELETE FROM scpi_valuations", []).map_err(|e| e.to_string())?; }
    for r in &rows {
        conn.execute("INSERT INTO scpi_valuations (poche,ticker,mois,valeur_unit) VALUES (?1,?2,?3,?4) ON CONFLICT(poche,ticker,mois) DO UPDATE SET valeur_unit=excluded.valeur_unit",
            params![r.poche,r.ticker,r.mois,r.valeur_unit])
            .map_err(|e| e.to_string())?;
    }
    Ok(rows.len())
}

// ═══ FETCH URL (proxy pour contourner CORS) ═══════════════════════════════════
#[tauri::command]
pub async fn fetch_url(url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}
