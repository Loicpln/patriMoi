use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::State;
use crate::db::*;

pub struct DbState(pub Mutex<rusqlite::Connection>);

// ═══ DÉPENSES ═══════════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_depenses(mois: Option<String>, state: State<DbState>) -> Result<Vec<Depense>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (sql, filtered) = match &mois {
        Some(_) => ("SELECT id,date,categorie,sous_categorie,libelle,montant,notes,recurrence_id FROM depenses WHERE strftime('%Y-%m',date)=?1 ORDER BY date DESC", true),
        None    => ("SELECT id,date,categorie,sous_categorie,libelle,montant,notes,recurrence_id FROM depenses ORDER BY date DESC", false),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| Ok(Depense { id:r.get(0)?,date:r.get(1)?,categorie:r.get(2)?,sous_categorie:r.get(3)?,libelle:r.get(4)?,montant:r.get(5)?,notes:r.get(6)?,recurrence_id:r.get(7)? });
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
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd").args(["/c", "start", "", &path]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
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
    let mut stmt = conn.prepare("SELECT id,poche,nom,montant,taux,date,notes FROM livrets ORDER BY date ASC").map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |r| Ok(Livret{id:r.get(0)?,poche:r.get(1)?,nom:r.get(2)?,montant:r.get(3)?,taux:r.get(4)?,date:r.get(5)?,notes:r.get(6)?}))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_livret(livret: Livret, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO livrets (poche,nom,montant,taux,date,notes) VALUES (?1,?2,?3,?4,?5,?6)",
        params![livret.poche,livret.nom,livret.montant,livret.taux,livret.date,livret.notes]).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn delete_livret(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM livrets WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ═══ LIVRET POCHES ═══════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_livret_poches(state: State<DbState>) -> Result<Vec<LivretPoche>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id,type_livret,nom,couleur FROM livret_poches ORDER BY type_livret,nom").map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |r| Ok(LivretPoche{id:r.get(0)?,type_livret:r.get(1)?,nom:r.get(2)?,couleur:r.get(3)?}))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_livret_poche(poche: LivretPoche, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO livret_poches (type_livret,nom,couleur) VALUES (?1,?2,?3) ON CONFLICT(type_livret,nom) DO NOTHING",
        params![poche.type_livret,poche.nom,poche.couleur]).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn update_livret_poche(id: i64, nom: String, couleur: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Fetch current type_livret + nom before updating (needed to cascade to livrets table)
    let (old_type, old_nom): (String, String) = conn
        .query_row("SELECT type_livret, nom FROM livret_poches WHERE id=?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    // Cascade nom rename to livrets rows
    if old_nom != nom {
        conn.execute(
            "UPDATE livrets SET nom=?1 WHERE poche=?2 AND nom=?3",
            params![nom, old_type, old_nom]).map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE livret_poches SET nom=?1, couleur=?2 WHERE id=?3",
        params![nom, couleur, id]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn delete_livret_poche(type_livret: String, nom: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM livrets WHERE poche=?1 AND nom=?2", params![type_livret,nom]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM livret_poches WHERE type_livret=?1 AND nom=?2", params![type_livret,nom]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn import_livret_ops(type_livret: String, nom: String, rows: Vec<Livret>, replace: bool, state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if replace {
        conn.execute("DELETE FROM livrets WHERE poche=?1 AND nom=?2", params![type_livret,nom]).map_err(|e| e.to_string())?;
    }
    for r in &rows {
        conn.execute("INSERT INTO livrets (poche,nom,montant,taux,date,notes) VALUES (?1,?2,?3,?4,?5,?6)",
            params![type_livret,nom,r.montant,r.taux,r.date,r.notes]).map_err(|e| e.to_string())?;
    }
    Ok(rows.len())
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
pub fn get_scpi_valuations(state: State<DbState>) -> Result<Vec<ScpiValuation>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let sql = "SELECT id,ticker,mois,valeur_unit FROM scpi_valuations ORDER BY mois DESC";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| Ok(ScpiValuation{id:r.get(0)?,ticker:r.get(1)?,mois:r.get(2)?,valeur_unit:r.get(3)?});
    let items = stmt.query_map([], map)
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_scpi_valuation(val: ScpiValuation, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO scpi_valuations (ticker,mois,valeur_unit) VALUES (?1,?2,?3) ON CONFLICT(ticker,mois) DO UPDATE SET valeur_unit=excluded.valeur_unit",
        params![val.ticker,val.mois,val.valeur_unit])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn delete_scpi_valuation(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM scpi_valuations WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Suppression complète d'une poche ─────────────────────────────────────────
#[tauri::command]
pub fn delete_poche_data(poche: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    for table in &["positions", "ventes", "dividendes", "versements"] {
        conn.execute(&format!("DELETE FROM {} WHERE poche=?1", table), params![poche])
            .map_err(|e| e.to_string())?;
    }
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
    let folder = rfd::FileDialog::new()
        .set_title("Sélectionner le dossier des fiches de paie")
        .pick_folder()
        .ok_or_else(|| "Aucun dossier sélectionné".to_string())?;
    Ok(folder.to_string_lossy().to_string())
}

/// Opens a folder picker, creates a dated subfolder (YYYY-MM-DD) inside it, and returns its path.
/// The JS side can then write files directly into the returned path.
#[tauri::command]
pub fn choose_export_folder() -> Result<String, String> {
    let parent = rfd::FileDialog::new()
        .set_title("Choisir le dossier de destination pour l'export")
        .pick_folder()
        .ok_or_else(|| "Aucun dossier sélectionné".to_string())?;
    // Build date string YYYY-MM-DD
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let days = now / 86400;
    let (y, m, d) = days_to_ymd(days as i64);
    let date_str = format!("{:04}-{:02}-{:02}", y, m, d);
    let subfolder = parent.join(&date_str);
    std::fs::create_dir_all(&subfolder).map_err(|e| format!("Impossible de créer le dossier : {}", e))?;
    Ok(subfolder.to_string_lossy().to_string())
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
pub fn export_all_csv(subfolder: String, livret_poches: Vec<LivretPoche>, state: State<DbState>) -> Result<Vec<String>, String> {
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

    // ── Dépenses (manuelles + modèles récurrents) ─────────────────────────
    {
        let header = "type,date,categorie,sous_categorie,libelle,montant,notes,periodicite,date_debut,date_fin";
        let mut lines: Vec<String> = Vec::new();
        // Dépenses manuelles uniquement (recurrence_id IS NULL)
        let mut stmt = conn.prepare(
            "SELECT date,categorie,sous_categorie,libelle,montant,notes FROM depenses WHERE recurrence_id IS NULL ORDER BY date DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            let montant: f64 = r.get(4)?;
            Ok(vec!["depense".into(), r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?, r.get::<_,String>(3)?, format!("{:.2}", montant), r.get::<_,Option<String>>(5)?.unwrap_or_default(), String::new(), String::new(), String::new()])
        }).map_err(|e| e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e| e.to_string())?)); }
        // Modèles récurrents
        let mut stmt = conn.prepare(
            "SELECT categorie,sous_categorie,libelle,montant,notes,periodicite,date_debut,date_fin FROM depenses_recurrentes ORDER BY date_debut DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            let montant: f64 = r.get(3)?;
            Ok(vec!["recurrente".into(), String::new(), r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?, format!("{:.2}", montant), r.get::<_,Option<String>>(4)?.unwrap_or_default(), r.get::<_,String>(5)?, r.get::<_,String>(6)?, r.get::<_,Option<String>>(7)?.unwrap_or_default()])
        }).map_err(|e| e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e| e.to_string())?)); }
        write_csv(dir, "depenses.csv", header, lines)?;
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

    // ── Livrets (par poche) ───────────────────────────────────────────────
    for p in &livret_poches {
        let safe = p.nom.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' }).collect::<String>();
        let filename = format!("{}.csv", safe);
        let mut stmt = conn.prepare(
            "SELECT id,date,montant,notes FROM livrets WHERE poche=?1 AND nom=?2 ORDER BY date ASC"
        ).map_err(|e| e.to_string())?;
        let lines: Vec<String> = stmt.query_map(params![p.type_livret, p.nom], |r| {
            let id: Option<i64> = r.get(0)?;
            let montant: f64 = r.get(2)?;
            let notes_str: String = r.get::<_, Option<String>>(3)?.unwrap_or_default();
            let is_interet = notes_str.starts_with("[INTERET");
            let is_retrait = !is_interet && montant < 0.0;
            let type_str = if is_interet { "interet" } else if is_retrait { "retrait" } else { "versement" };
            Ok(vec![
                id.map_or("".into(), |v| v.to_string()),
                r.get::<_, String>(1)?,
                type_str.to_string(),
                format!("{:.2}", montant.abs()),
                notes_str,
            ])
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).map(|f| row(&f)).collect();
        write_csv(dir, &filename, "id,date,type,montant,notes", lines)?;
        written.push(filename);
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
        let mut stmt=conn.prepare("SELECT id,ticker,mois,valeur_unit FROM scpi_valuations ORDER BY ticker,mois").map_err(|e|e.to_string())?;
        let lines:Vec<String>=stmt.query_map([],|r|{
            let id:Option<i64>=r.get(0)?; let v:f64=r.get(3)?;
            Ok(vec![id.map_or("".into(),|x|x.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,format!("{}",v)])
        }).map_err(|e|e.to_string())?.filter_map(|r|r.ok()).map(|f|row(&f)).collect();
        write_csv(dir,"scpi_valorisations.csv","id,ticker,mois,valeur_unit",lines)?;
        written.push("scpi_valorisations.csv".into());
    }

    Ok(written)
}

/// Pick a folder, create `{prefix}_{YYYY-MM-DD}` subfolder inside it, return its path.
fn pick_named_dated_folder(prefix: &str) -> Result<std::path::PathBuf, String> {
    let parent = rfd::FileDialog::new()
        .set_title("Choisir le dossier de destination")
        .pick_folder()
        .ok_or_else(|| "Annulé".to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let (y, m, d) = days_to_ymd((now / 86400) as i64);
    let dir = parent.join(format!("{}_{:04}-{:02}-{:02}", prefix, y, m, d));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer le dossier: {}", e))?;
    Ok(dir)
}

/// Export toutes les poches d'investissement dans un dossier `investissements_DATE`.
#[tauri::command]
pub fn export_invest_csv(poches: Vec<String>, state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let dir = pick_named_dated_folder("investissements")?;
    let mut written: Vec<String> = Vec::new();

    fn esc(v: &str) -> String {
        if v.contains(',') || v.contains('"') || v.contains('\n') { format!("\"{}\"", v.replace('"', "\"\"")) } else { v.to_string() }
    }
    fn row(fields: &[String]) -> String { fields.iter().map(|f| esc(f)).collect::<Vec<_>>().join(",") }
    fn write_csv(dir: &std::path::Path, name: &str, header: &str, lines: Vec<String>) -> Result<(), String> {
        let mut content = "\u{FEFF}".to_string();
        content.push_str(header); content.push('\n');
        for l in lines { content.push_str(&l); content.push('\n'); }
        std::fs::write(dir.join(name), content).map_err(|e| format!("{}: {}", name, e))
    }

    let poche_header = "type,id,date,ticker,nom,sous_categorie,quantite,prix_achat,prix_vente,pnl,montant,notes";
    for poche_key in &poches {
        let filename = match poche_key.as_str() { "av" => "assurance_vie.csv".to_string(), k => format!("{}.csv", k) };
        let mut lines: Vec<String> = Vec::new();
        let mut stmt = conn.prepare("SELECT id,date_achat,ticker,nom,sous_categorie,quantite,prix_achat,notes FROM positions WHERE poche=?1 ORDER BY date_achat").map_err(|e|e.to_string())?;
        let rows = stmt.query_map([poche_key],|r|{
            let id:Option<i64>=r.get(0)?; let qty:f64=r.get(5)?; let px:f64=r.get(6)?;
            Ok(vec!["Position".into(),id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?.unwrap_or_default(),format!("{}",qty),format!("{}",px),"".into(),"".into(),"".into(),r.get::<_,Option<String>>(7)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e|e.to_string())?)); }
        let mut stmt = conn.prepare("SELECT id,date_vente,ticker,nom,quantite,prix_achat,prix_vente,pnl,notes FROM ventes WHERE poche=?1 ORDER BY date_vente").map_err(|e|e.to_string())?;
        let rows = stmt.query_map([poche_key],|r|{
            let id:Option<i64>=r.get(0)?; let qty:f64=r.get(4)?; let pa:f64=r.get(5)?; let pv:f64=r.get(6)?; let pnl:f64=r.get(7)?;
            Ok(vec!["Vente".into(),id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,String::new(),format!("{}",qty),format!("{}",pa),format!("{}",pv),format!("{}",pnl),String::new(),r.get::<_,Option<String>>(8)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e|e.to_string())?)); }
        let mut stmt = conn.prepare("SELECT id,date,ticker,montant,notes FROM dividendes WHERE poche=?1 ORDER BY date").map_err(|e|e.to_string())?;
        let rows = stmt.query_map([poche_key],|r|{
            let id:Option<i64>=r.get(0)?; let m:f64=r.get(3)?;
            Ok(vec!["Dividende".into(),id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,r.get::<_,String>(2)?,String::new(),String::new(),String::new(),String::new(),String::new(),String::new(),format!("{}",m),r.get::<_,Option<String>>(4)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e|e.to_string())?)); }
        let mut stmt = conn.prepare("SELECT id,date,montant,notes FROM versements WHERE poche=?1 ORDER BY date").map_err(|e|e.to_string())?;
        let rows = stmt.query_map([poche_key],|r|{
            let id:Option<i64>=r.get(0)?; let m:f64=r.get(2)?;
            Ok(vec!["Versement".into(),id.map_or("".into(),|v|v.to_string()),r.get::<_,String>(1)?,String::new(),String::new(),String::new(),String::new(),String::new(),String::new(),String::new(),format!("{}",m),r.get::<_,Option<String>>(3)?.unwrap_or_default()])
        }).map_err(|e|e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e|e.to_string())?)); }
        write_csv(&dir, &filename, poche_header, lines)?;
        written.push(filename);
    }
    Ok(written)
}

/// Export toutes les poches de livrets dans un dossier `livrets_DATE`.
#[tauri::command]
pub fn export_livrets_batch(livret_poches: Vec<LivretPoche>, state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let dir = pick_named_dated_folder("livrets")?;
    let mut written: Vec<String> = Vec::new();

    fn esc(v: &str) -> String {
        if v.contains(',') || v.contains('"') || v.contains('\n') { format!("\"{}\"", v.replace('"', "\"\"")) } else { v.to_string() }
    }
    fn row(fields: &[String]) -> String { fields.iter().map(|f| esc(f)).collect::<Vec<_>>().join(",") }
    fn write_csv(dir: &std::path::Path, name: &str, header: &str, lines: Vec<String>) -> Result<(), String> {
        let mut content = "\u{FEFF}".to_string();
        content.push_str(header); content.push('\n');
        for l in lines { content.push_str(&l); content.push('\n'); }
        std::fs::write(dir.join(name), content).map_err(|e| format!("{}: {}", name, e))
    }

    for p in &livret_poches {
        let safe = p.nom.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' }).collect::<String>();
        let filename = format!("{}.csv", safe);
        let mut stmt = conn.prepare(
            "SELECT id,date,montant,notes FROM livrets WHERE poche=?1 AND nom=?2 ORDER BY date ASC"
        ).map_err(|e| e.to_string())?;
        let lines: Vec<String> = stmt.query_map(params![p.type_livret, p.nom], |r| {
            let id: Option<i64> = r.get(0)?;
            let montant: f64 = r.get(2)?;
            let notes_str: String = r.get::<_, Option<String>>(3)?.unwrap_or_default();
            let is_interet = notes_str.starts_with("[INTERET");
            let is_retrait = !is_interet && montant < 0.0;
            let type_str = if is_interet { "interet" } else if is_retrait { "retrait" } else { "versement" };
            Ok(vec![
                id.map_or("".into(), |v| v.to_string()),
                r.get::<_, String>(1)?,
                type_str.to_string(),
                format!("{:.2}", montant.abs()),
                notes_str,
            ])
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).map(|f| row(&f)).collect();
        write_csv(&dir, &filename, "id,date,type,montant,notes", lines)?;
        written.push(filename);
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
pub fn import_depenses_recurrentes(rows: Vec<DepenseRecurrente>, replace: bool, state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if replace {
        conn.execute("DELETE FROM depenses_recurrentes", []).map_err(|e| e.to_string())?;
    }
    for r in &rows {
        conn.execute(
            "INSERT INTO depenses_recurrentes (categorie,sous_categorie,libelle,montant,periodicite,date_debut,date_fin,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![r.categorie, r.sous_categorie, r.libelle, r.montant, r.periodicite, r.date_debut, r.date_fin, r.notes],
        ).map_err(|e| e.to_string())?;
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
        conn.execute("INSERT INTO livrets (poche,nom,montant,taux,date,notes) VALUES (?1,?2,?3,?4,?5,?6)",
            params![r.poche,r.nom,r.montant,r.taux,r.date,r.notes])
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
        conn.execute("INSERT INTO scpi_valuations (ticker,mois,valeur_unit) VALUES (?1,?2,?3) ON CONFLICT(ticker,mois) DO UPDATE SET valeur_unit=excluded.valeur_unit",
            params![r.ticker,r.mois,r.valeur_unit])
            .map_err(|e| e.to_string())?;
    }
    Ok(rows.len())
}

// ═══ DÉPENSES RÉCURRENTES ════════════════════════════════════════════════════

/// Extrait le numéro de jour (1-31) depuis une date YYYY-MM-DD.
fn anchor_day(date: &str) -> u32 {
    date.get(8..10)
        .and_then(|s| s.parse().ok())
        .unwrap_or(1)
}

/// Calcule le dernier jour du mois pour un préfixe YYYY-MM via SQLite.
fn last_day_of_month(conn: &Connection, ym_prefix: &str) -> rusqlite::Result<u32> {
    conn.query_row(
        &format!("SELECT CAST(strftime('%d', date('{}-01', '+1 month', '-1 day')) AS INTEGER)", ym_prefix),
        [],
        |r| r.get(0),
    )
}

/// Avance d'une période en respectant le jour d'ancrage (anchor_day).
/// - hebdomadaire : +7 jours (pas de problème de mois)
/// - mensuel      : mois suivant, jour = MIN(anchor_day, dernier_jour_du_mois)
/// - annuel       : année suivante, même logique
fn generate_next_date(conn: &Connection, current: &str, periodicite: &str, anchor: u32) -> rusqlite::Result<String> {
    if periodicite == "hebdomadaire" {
        return conn.query_row(
            &format!("SELECT date('{}', '+7 days')", current),
            [], |r| r.get(0),
        );
    }

    let interval = if periodicite == "annuel" { "+1 year" } else { "+1 month" };

    // IMPORTANT : on avance depuis le 1er du mois courant (pas depuis `current`)
    // pour éviter le débordement de SQLite : date('2025-01-30', '+1 month') → 2025-03-02
    // alors que date('2025-01-01', '+1 month') → 2025-02-01 (correct)
    let current_ym = &current[..7]; // "YYYY-MM"
    let next_ym: String = conn.query_row(
        &format!("SELECT strftime('%Y-%m', date('{}-01', '{}'))", current_ym, interval),
        [], |r| r.get(0),
    )?;

    // Calculer le dernier jour disponible dans ce mois et appliquer l'ancrage
    let last = last_day_of_month(conn, &next_ym)?;
    let day = anchor.min(last);

    Ok(format!("{}-{:02}", next_ym, day))
}

fn process_one_recurrence(conn: &Connection, rec_id: i64) -> rusqlite::Result<usize> {
    let (cat, sous_cat, libelle, montant, periodicite, date_debut, date_fin, notes):
        (String, String, String, f64, String, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT categorie,sous_categorie,libelle,montant,periodicite,date_debut,date_fin,notes
             FROM depenses_recurrentes WHERE id=?1",
            [rec_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?))
        )?;

    // Jour d'ancrage extrait une fois depuis date_debut (ex: 30 si date_debut = 2024-01-30)
    let anchor = anchor_day(&date_debut);

    let end_date: String = conn.query_row(
        "SELECT COALESCE(MIN(?1, date('now')), date('now'))",
        [date_fin.as_deref().unwrap_or("9999-12-31")],
        |r| r.get(0),
    )?;

    let mut existing_stmt = conn.prepare(
        "SELECT date FROM depenses WHERE recurrence_id=?1"
    )?;
    let existing: std::collections::HashSet<String> = existing_stmt
        .query_map([rec_id], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut current = date_debut.clone();
    let mut count = 0;
    while current <= end_date {
        if !existing.contains(&current) {
            conn.execute(
                "INSERT INTO depenses (date,categorie,sous_categorie,libelle,montant,notes,recurrence_id) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                rusqlite::params![current, cat, sous_cat, libelle, montant, notes, rec_id],
            )?;
            count += 1;
        }
        current = generate_next_date(conn, &current, &periodicite, anchor)?;
    }
    Ok(count)
}

pub fn process_recurrences_sync(conn: &Connection) -> usize {
    let ids: Vec<i64> = match conn.prepare("SELECT id FROM depenses_recurrentes") {
        Err(_) => return 0,
        Ok(mut s) => s.query_map([], |r| r.get(0))
            .unwrap_or_else(|_| panic!("query_map failed"))
            .filter_map(|r| r.ok())
            .collect(),
    };
    let mut total = 0;
    for id in ids {
        if let Ok(n) = process_one_recurrence(conn, id) { total += n; }
    }
    total
}

#[tauri::command]
pub fn get_depenses_recurrentes(state: State<DbState>) -> Result<Vec<DepenseRecurrente>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id,categorie,sous_categorie,libelle,montant,periodicite,date_debut,date_fin,notes FROM depenses_recurrentes ORDER BY date_debut DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |r| Ok(DepenseRecurrente {
        id: r.get(0)?, categorie: r.get(1)?, sous_categorie: r.get(2)?,
        libelle: r.get(3)?, montant: r.get(4)?, periodicite: r.get(5)?,
        date_debut: r.get(6)?, date_fin: r.get(7)?, notes: r.get(8)?,
    })).map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn add_depense_recurrente(rec: DepenseRecurrente, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO depenses_recurrentes (categorie,sous_categorie,libelle,montant,periodicite,date_debut,date_fin,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![rec.categorie, rec.sous_categorie, rec.libelle, rec.montant, rec.periodicite, rec.date_debut, rec.date_fin, rec.notes],
    ).map_err(|e| e.to_string())?;
    let new_id = conn.last_insert_rowid();
    process_one_recurrence(&conn, new_id).map_err(|e| e.to_string())?;
    Ok(new_id)
}

#[tauri::command]
pub fn update_depense_recurrente(rec: DepenseRecurrente, state: State<DbState>) -> Result<(), String> {
    let id = rec.id.ok_or("Missing id")?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE depenses_recurrentes SET categorie=?1,sous_categorie=?2,libelle=?3,montant=?4,periodicite=?5,date_debut=?6,date_fin=?7,notes=?8 WHERE id=?9",
        params![rec.categorie, rec.sous_categorie, rec.libelle, rec.montant, rec.periodicite, rec.date_debut, rec.date_fin, rec.notes, id],
    ).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM depenses WHERE recurrence_id=?1", params![id]).map_err(|e| e.to_string())?;
    process_one_recurrence(&conn, id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_depense_recurrente(id: i64, delete_generated: bool, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM depenses_recurrentes WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    if delete_generated {
        conn.execute("DELETE FROM depenses WHERE recurrence_id=?1", params![id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn process_depenses_recurrentes(state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let ids: Vec<i64> = conn.prepare("SELECT id FROM depenses_recurrentes")
        .map_err(|e| e.to_string())?
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    let mut total = 0;
    for id in ids {
        total += process_one_recurrence(&conn, id).map_err(|e| e.to_string())?;
    }
    Ok(total)
}

// ═══ PARIS SPORTIFS ══════════════════════════════════════════════════════════
#[tauri::command]
pub fn get_paris_poches(state: State<DbState>) -> Result<Vec<ParisPoche>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id,nom,couleur FROM paris_poches ORDER BY nom").map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |r| Ok(ParisPoche{id:r.get(0)?,nom:r.get(1)?,couleur:r.get(2)?}))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}
#[tauri::command]
pub fn add_paris_poche(poche: ParisPoche, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO paris_poches (nom,couleur) VALUES (?1,?2)",
        params![poche.nom,poche.couleur]).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn update_paris_poche(id: i64, nom: String, couleur: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE paris_poches SET nom=?1,couleur=?2 WHERE id=?3",
        params![nom,couleur,id]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn delete_paris_poche(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let nom: String = conn.query_row("SELECT nom FROM paris_poches WHERE id=?1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    // Delete selections via FK cascade, then paris, then poche
    let paris_ids: Vec<i64> = {
        let mut s = conn.prepare("SELECT id FROM paris WHERE poche=?1").map_err(|e| e.to_string())?;
        let ids = s.query_map(params![nom], |r| r.get(0))
            .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        ids
    };
    for pid in &paris_ids {
        conn.execute("DELETE FROM paris_selections WHERE pari_id=?1", params![pid]).map_err(|e| e.to_string())?;
    }
    conn.execute("DELETE FROM paris WHERE poche=?1", params![nom]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM paris_poches WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn get_paris(poche: Option<String>, mois: Option<String>, state: State<DbState>) -> Result<Vec<Pari>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let sql = match (&poche, &mois) {
        (Some(_), Some(_)) => "SELECT id,poche,date,freebet,mise,cote,gain,statut,notes FROM paris WHERE poche=?1 AND substr(date,1,7)=?2 ORDER BY date DESC",
        (Some(_), None)    => "SELECT id,poche,date,freebet,mise,cote,gain,statut,notes FROM paris WHERE poche=?1 ORDER BY date DESC",
        (None,    Some(_)) => "SELECT id,poche,date,freebet,mise,cote,gain,statut,notes FROM paris WHERE substr(date,1,7)=?1 ORDER BY date DESC",
        (None,    None)    => "SELECT id,poche,date,freebet,mise,cote,gain,statut,notes FROM paris ORDER BY date DESC",
    };
    let map_row = |r: &rusqlite::Row| Ok(Pari{
        id:r.get(0)?,poche:r.get(1)?,date:r.get(2)?,
        freebet:r.get::<_,i64>(3)?!=0,
        mise:r.get(4)?,cote:r.get(5)?,gain:r.get(6)?,
        statut:r.get(7)?,notes:r.get(8)?,selections:None,
    });
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut paris: Vec<Pari> = match (&poche, &mois) {
        (Some(p), Some(m)) => stmt.query_map(params![p,m], map_row),
        (Some(p), None)    => stmt.query_map(params![p],   map_row),
        (None,    Some(m)) => stmt.query_map(params![m],   map_row),
        (None,    None)    => stmt.query_map([],            map_row),
    }.map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;

    // Load selections for each pari
    for p in &mut paris {
        if let Some(pid) = p.id {
            let mut ss = conn.prepare("SELECT id,pari_id,categorie,resultat FROM paris_selections WHERE pari_id=?1 ORDER BY id")
                .map_err(|e| e.to_string())?;
            let sels: Vec<ParisSelection> = ss.query_map(params![pid], |r| Ok(ParisSelection{id:r.get(0)?,pari_id:r.get(1)?,categorie:r.get(2)?,resultat:r.get(3)?}))
                .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
            p.selections = Some(sels);
        }
    }
    Ok(paris)
}
#[tauri::command]
pub fn add_pari(pari: Pari, state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let freebet_int: i64 = if pari.freebet { 1 } else { 0 };
    conn.execute(
        "INSERT INTO paris (poche,date,freebet,mise,cote,gain,statut,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![pari.poche,pari.date,freebet_int,pari.mise,pari.cote,pari.gain,pari.statut,pari.notes])
        .map_err(|e| e.to_string())?;
    let pari_id = conn.last_insert_rowid();
    if let Some(sels) = &pari.selections {
        for s in sels {
            conn.execute("INSERT INTO paris_selections (pari_id,categorie,resultat) VALUES (?1,?2,?3)",
                params![pari_id,s.categorie,s.resultat]).map_err(|e| e.to_string())?;
        }
    }
    Ok(pari_id)
}
#[tauri::command]
pub fn update_pari(pari: Pari, state: State<DbState>) -> Result<(), String> {
    let id = pari.id.ok_or("Missing id")?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let freebet_int: i64 = if pari.freebet { 1 } else { 0 };
    conn.execute(
        "UPDATE paris SET poche=?1,date=?2,freebet=?3,mise=?4,cote=?5,gain=?6,statut=?7,notes=?8 WHERE id=?9",
        params![pari.poche,pari.date,freebet_int,pari.mise,pari.cote,pari.gain,pari.statut,pari.notes,id])
        .map_err(|e| e.to_string())?;
    // Replace selections
    conn.execute("DELETE FROM paris_selections WHERE pari_id=?1", params![id]).map_err(|e| e.to_string())?;
    if let Some(sels) = &pari.selections {
        for s in sels {
            conn.execute("INSERT INTO paris_selections (pari_id,categorie,resultat) VALUES (?1,?2,?3)",
                params![id,s.categorie,s.resultat]).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn delete_pari(id: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM paris_selections WHERE pari_id=?1", params![id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM paris WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn import_paris(poche: String, paris: Vec<Pari>, replace: bool, state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if replace {
        let ids: Vec<i64> = {
            let mut s = conn.prepare("SELECT id FROM paris WHERE poche=?1").map_err(|e| e.to_string())?;
            let ids = s.query_map(params![poche], |r| r.get(0))
                .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
            ids
        };
        for pid in &ids {
            conn.execute("DELETE FROM paris_selections WHERE pari_id=?1", params![pid]).map_err(|e| e.to_string())?;
        }
        conn.execute("DELETE FROM paris WHERE poche=?1", params![poche]).map_err(|e| e.to_string())?;
    }
    let mut count = 0usize;
    for p in &paris {
        let freebet_int: i64 = if p.freebet { 1 } else { 0 };
        conn.execute(
            "INSERT INTO paris (poche,date,freebet,mise,cote,gain,statut,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![poche,p.date,freebet_int,p.mise,p.cote,p.gain,p.statut,p.notes])
            .map_err(|e| e.to_string())?;
        let pari_id = conn.last_insert_rowid();
        if let Some(sels) = &p.selections {
            for s in sels {
                conn.execute("INSERT INTO paris_selections (pari_id,categorie,resultat) VALUES (?1,?2,?3)",
                    params![pari_id,s.categorie,s.resultat]).map_err(|e| e.to_string())?;
            }
        }
        count += 1;
    }
    Ok(count)
}

// ═══ EXPORT ICLOUD ═══════════════════════════════════════════════════════════
/// Exporte livrets.csv + une CSV par poche d'investissement
/// dans ~/Library/Mobile Documents/com~apple~CloudDocs/PatriMe/
/// pour synchronisation avec l'app iOS PatriMe.
#[tauri::command]
pub fn export_to_icloud(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // iCloud Drive path on macOS
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let icloud_dir = std::path::PathBuf::from(&home)
        .join("Library/Mobile Documents/com~apple~CloudDocs/PatriMe");
    std::fs::create_dir_all(&icloud_dir)
        .map_err(|e| format!("Impossible de créer le dossier iCloud : {}", e))?;

    fn esc(v: &str) -> String {
        if v.contains(',') || v.contains('"') || v.contains('\n') {
            format!("\"{}\"", v.replace('"', "\"\""))
        } else { v.to_string() }
    }
    fn row(fields: &[String]) -> String { fields.iter().map(|f| esc(f)).collect::<Vec<_>>().join(",") }
    fn write_csv(dir: &std::path::Path, name: &str, header: &str, lines: Vec<String>) -> Result<(), String> {
        let mut content = "\u{FEFF}".to_string();
        content.push_str(header); content.push('\n');
        for l in lines { content.push_str(&l); content.push('\n'); }
        std::fs::write(dir.join(name), content).map_err(|e| format!("{}: {}", name, e))
    }

    // ── Livrets — une CSV par compte (poche + nom) ───────────────────────────
    {
        // Récupère les couples distincts (poche, nom)
        let comptes: Vec<(String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT poche, COALESCE(nom,'') FROM livrets ORDER BY poche, nom"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?)))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for (poche, nom) in &comptes {
            let mut stmt = conn.prepare(
                "SELECT id,poche,nom,date,montant,taux,notes FROM livrets WHERE poche=?1 AND COALESCE(nom,'')=?2 ORDER BY date ASC"
            ).map_err(|e| e.to_string())?;
            let lines: Vec<String> = stmt.query_map(params![poche, nom], |r| {
                let id: Option<i64> = r.get(0)?;
                let montant: f64 = r.get(4)?;
                let taux: f64 = r.get(5)?;
                Ok(vec![
                    id.map_or("".into(), |v| v.to_string()),
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, String>(3)?,
                    format!("{:.2}", montant),
                    format!("{:.4}", taux),
                    r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                ])
            }).map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|f| row(&f))
            .collect();

            // Nom du fichier : "livret_{nom}.csv" ou "livret_{poche}.csv" si nom vide
            let label = if nom.is_empty() { poche.clone() } else { nom.clone() };
            let safe: String = label.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' }).collect();
            let filename = format!("livret_{}.csv", safe);
            write_csv(&icloud_dir, &filename, "id,poche,nom,date,montant,taux,notes", lines)?;
        }
    }

    // ── Investissements — une CSV par poche ──────────────────────────────────
    let poche_header = "type,id,date,ticker,nom,sous_categorie,quantite,prix_achat,prix_vente,pnl,montant,notes";
    let poches: Vec<String> = {
        let mut stmt = conn.prepare("SELECT DISTINCT poche FROM positions ORDER BY poche").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    for poche_key in &poches {
        let safe: String = poche_key.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' }).collect();
        let filename = format!("{}.csv", safe);
        let mut lines: Vec<String> = Vec::new();

        // Positions
        let mut stmt = conn.prepare(
            "SELECT id,date_achat,ticker,nom,sous_categorie,quantite,prix_achat,notes FROM positions WHERE poche=?1 ORDER BY date_achat"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([poche_key], |r| {
            let id: Option<i64> = r.get(0)?; let qty: f64 = r.get(5)?; let px: f64 = r.get(6)?;
            Ok(vec!["Position".into(), id.map_or("".into(),|v|v.to_string()),
                r.get::<_,String>(1)?, r.get::<_,String>(2)?, r.get::<_,String>(3)?,
                r.get::<_,Option<String>>(4)?.unwrap_or_default(),
                format!("{}", qty), format!("{}", px),
                "".into(), "".into(), "".into(),
                r.get::<_,Option<String>>(7)?.unwrap_or_default()])
        }).map_err(|e| e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e| e.to_string())?)); }

        // Ventes
        let mut stmt = conn.prepare(
            "SELECT id,date_vente,ticker,nom,quantite,prix_achat,prix_vente,pnl,notes FROM ventes WHERE poche=?1 ORDER BY date_vente"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([poche_key], |r| {
            let id: Option<i64> = r.get(0)?; let qty: f64 = r.get(4)?;
            let pa: f64 = r.get(5)?; let pv: f64 = r.get(6)?; let pnl: f64 = r.get(7)?;
            Ok(vec!["Vente".into(), id.map_or("".into(),|v|v.to_string()),
                r.get::<_,String>(1)?, r.get::<_,String>(2)?, r.get::<_,String>(3)?,
                "".into(), format!("{}", qty), format!("{}", pa),
                format!("{}", pv), format!("{}", pnl), "".into(),
                r.get::<_,Option<String>>(8)?.unwrap_or_default()])
        }).map_err(|e| e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e| e.to_string())?)); }

        // Dividendes
        let mut stmt = conn.prepare(
            "SELECT id,date,ticker,montant,notes FROM dividendes WHERE poche=?1 ORDER BY date"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([poche_key], |r| {
            let id: Option<i64> = r.get(0)?; let m: f64 = r.get(3)?;
            Ok(vec!["Dividende".into(), id.map_or("".into(),|v|v.to_string()),
                r.get::<_,String>(1)?, r.get::<_,String>(2)?,
                "".into(), "".into(), "".into(), "".into(), "".into(), "".into(),
                format!("{}", m), r.get::<_,Option<String>>(4)?.unwrap_or_default()])
        }).map_err(|e| e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e| e.to_string())?)); }

        // Versements
        let mut stmt = conn.prepare(
            "SELECT id,date,montant,notes FROM versements WHERE poche=?1 ORDER BY date"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([poche_key], |r| {
            let id: Option<i64> = r.get(0)?; let m: f64 = r.get(2)?;
            Ok(vec!["Versement".into(), id.map_or("".into(),|v|v.to_string()),
                r.get::<_,String>(1)?, "".into(), "".into(), "".into(),
                "".into(), "".into(), "".into(), "".into(),
                format!("{}", m), r.get::<_,Option<String>>(3)?.unwrap_or_default()])
        }).map_err(|e| e.to_string())?;
        for r in rows { lines.push(row(&r.map_err(|e| e.to_string())?)); }

        write_csv(&icloud_dir, &filename, poche_header, lines)?;
    }

    Ok(icloud_dir.to_string_lossy().to_string())
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
