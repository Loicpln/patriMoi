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
    let mut stmt = conn.prepare("SELECT id,quantite,prix_achat FROM positions WHERE poche=?1 AND ticker=?2 ORDER BY date_achat ASC").map_err(|e| e.to_string())?;
    let rows: Vec<(i64,f64,f64)> = stmt.query_map(params![poche,ticker], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    let total_qty: f64 = rows.iter().map(|r| r.1).sum();
    // Compute already-sold quantity from ventes table to check available quantity
    let sold_qty: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantite),0.0) FROM ventes WHERE poche=?1 AND ticker=?2",
        params![poche, ticker],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let available_qty = (total_qty - sold_qty).max(0.0);
    if quantite_vendue > available_qty + 1e-9 {
        return Err(format!("Quantité vendue ({:.4}) > disponible ({:.4})", quantite_vendue, available_qty));
    }
    let pru: f64 = if total_qty > 0.0 { rows.iter().map(|r| r.1*r.2).sum::<f64>() / total_qty } else { 0.0 };
    let pnl = (prix_vente - pru) * quantite_vendue;
    conn.execute("INSERT INTO ventes (poche,ticker,nom,quantite,prix_achat,prix_vente,date_vente,pnl,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![poche,ticker,nom,quantite_vendue,pru,prix_vente,date_vente,pnl,notes]).map_err(|e| e.to_string())?;
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
