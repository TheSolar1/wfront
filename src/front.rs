// ══════════════════════════════════════════════════════════════════
// front.rs — Expansion et invasion facon OpenFront
//
// Chaque nation a une reserve de troupes qui se remplit toute seule
// (plus vite quand elle est vide, jusqu'a un maximum qui grandit avec le
// territoire, les villes, la capitale et les casernes).
//
// Un clic droit sur une case envoie une part des troupes (« ratio ») :
//   - terre neutre        : le pays s'etend case par case
//   - nation en guerre    : le front avance dans son territoire, contre
//                           ses troupes, son relief et ses fortifications
//   - cote hors d'atteinte: debarquement depuis un chantier naval
// Le front avance vers la case cliquee. Les troupes qui restent quand
// l'offensive s'arrete rentrent dans la reserve.
// ══════════════════════════════════════════════════════════════════

use crate::defs::*;
use crate::jeu::{capturer, Bilan};
use crate::monde::*;
use std::collections::HashMap;

/// Troupes perdues par case neutre prise (multiplie par le cout du relief).
pub const COUT_NEUTRE: f64 = 14.0;
/// Base du cout d'une case ennemie (avant relief, forts et densite).
pub const COUT_ENNEMI: f64 = 9.0;
/// Portee maximale d'un debarquement depuis un chantier naval (cases).
pub const PORTEE_BATEAU: i64 = 30;
/// Sans chantier naval : on traverse quand meme un bras de mer jusqu'a une
/// terre proche (distance depuis l'une de ses propres cotes).
pub const PORTEE_COTE: i64 = 8;
pub const TROUPES_DEPART: f64 = 500.0;

/// Maximum de troupes d'une nation.
pub fn maximum(p: &Pays, b: &Bilan) -> f64 {
    let mut m = 500.0
        + 10.0 * b.cases as f64
        + 1200.0 * b.n("capitale")
        + 250.0 * b.n("ville")
        + 300.0 * b.n("caserne")
        + 200.0 * b.n("centre_admin")
        // Anciens bonus de « capacite territoriale » (centres administratifs,
        // villes, ONU, specialisations...) : 40 troupes de plus chacun.
        + 40.0 * b.capacite as f64;
    m *= 1.0 + 0.05 * p.niv("armement") + crate::fabrication::effet(&p.stock, "troupes");
    if p.spe == "militaire" {
        m *= 1.15;
    }
    m.round()
}

/// Troupes gagnees par seconde de jeu.
pub fn croissance(p: &Pays, max: f64, affame: bool) -> f64 {
    if max <= 0.0 {
        return 0.0;
    }
    let g = (2.0 + max * 0.0025) * (1.0 - p.troupes / max).max(0.0);
    if affame { g * 0.3 } else { g }
}

/// Cout (troupes) pour prendre la case `i` a son proprietaire actuel.
pub fn cout_case(m: &Monde, i: usize) -> f64 {
    let c = &m.cases[i];
    let t = &TERRAINS[c.terrain as usize];
    match c.proprio {
        None => COUT_NEUTRE * t.cout_mvt,
        Some(d) => {
            let fort = if c.bat.as_deref() == Some("fort") { 1.0 + 0.3 * c.niv as f64 } else { 1.0 };
            COUT_ENNEMI * t.cout_mvt * (1.0 + t.defense) * fort + 0.8 * densite(m, d)
        }
    }
}

/// Troupes du defenseur par case de son territoire.
fn densite(m: &Monde, d: u32) -> f64 {
    let cases = m.cases.iter().filter(|c| c.proprio == Some(d)).count().max(1) as f64;
    m.pays.get(&d).map(|p| p.troupes / cases).unwrap_or(0.0)
}

fn touche(m: &Monde, pid: u32, i: usize) -> bool {
    m.voisins(i).iter().any(|&v| m.cases[v].proprio == Some(pid))
}

/// Point de depart d'un debarquement vers `i` : un chantier naval a moins de
/// PORTEE_BATEAU cases, ou a defaut l'une de ses cotes a moins de
/// PORTEE_COTE cases. Rend (case de depart, distance).
fn depart_bateau(m: &Monde, pid: u32, i: usize) -> Option<(usize, i64)> {
    let port = m
        .cases
        .iter()
        .enumerate()
        .filter(|(_, c)| c.proprio == Some(pid) && c.bat.as_deref() == Some("port"))
        .map(|(k, _)| (k, m.distance(k, i)))
        .filter(|&(_, d)| d <= PORTEE_BATEAU)
        .min_by_key(|&(_, d)| d);
    port.or_else(|| {
        m.rayon(i, PORTEE_COTE)
            .into_iter()
            .filter(|&k| m.cases[k].proprio == Some(pid) && m.est_cote(k))
            .map(|k| (k, m.distance(k, i)))
            .min_by_key(|&(_, d)| d)
    })
}

/// Commande « etendre » : envoie `ratio` des troupes vers la case `i`.
pub fn etendre(m: &mut Monde, pid: u32, i: usize, ratio: f64, maint: i64) -> Result<String, String> {
    let c = m.cases.get(i).ok_or("Case invalide.")?;
    if !est_terre(c.terrain) {
        return Err("Visez une case de terre.".into());
    }
    if m.zone_morte(i) {
        return Err("Zone morte du trou noir : plus rien n'y vit.".into());
    }
    let c = &m.cases[i];
    let cible = c.proprio;
    if cible == Some(pid) {
        return Err("Cette province est déjà à vous.".into());
    }
    if let Some(d) = cible {
        if !m.en_guerre(pid, d) {
            return Err(format!("Vous n'êtes pas en guerre contre {} : déclarez-lui la guerre d'abord (Diplomatie).", m.nom_pays(d)));
        }
        if m.pays.get(&d).map(|p| p.protection > maint).unwrap_or(false) {
            return Err("Cette nation est encore sous protection.".into());
        }
    }
    let ratio = if ratio.is_finite() { ratio.clamp(0.05, 1.0) } else { 0.3 };
    let p = m.pays.get(&pid).ok_or("Pays introuvable.")?;
    let envoi = (p.troupes * ratio).floor();
    if envoi < 10.0 {
        return Err("Pas assez de troupes : attendez que votre réserve se remplisse.".into());
    }

    let bateau = if touche(m, pid, i) {
        None
    } else {
        let cotier = m.est_cote(i);
        match depart_bateau(m, pid, i) {
            Some((_, d)) if cotier => Some((i, 4.0 + d as f64 * 1.2)),
            _ if cotier => {
                return Err(format!(
                    "Trop loin : vos côtes doivent être à moins de {} cases (ou un chantier naval à moins de {} cases).",
                    PORTEE_COTE, PORTEE_BATEAU
                ))
            }
            _ => return Err("Cette province ne touche pas votre territoire.".into()),
        }
    };

    // Renfort d'une offensive deja en cours contre la meme cible.
    if bateau.is_none() {
        if let Some(a) = m.attaques.values_mut().find(|a| a.de == pid && a.cible == cible && a.bateau.is_none()) {
            a.troupes += envoi;
            a.vise = i;
            m.pays.get_mut(&pid).unwrap().troupes -= envoi;
            return Ok(format!("{} troupes en renfort.", envoi));
        }
    }
    let id = m.nouvel_id();
    m.attaques.insert(id, Attaque { id, de: pid, cible, troupes: envoi, vise: i, prises: 0, progres: 0.0, bateau });
    m.pays.get_mut(&pid).unwrap().troupes -= envoi;
    let quoi = match (cible, bateau.is_some()) {
        (_, true) => format!("{} troupes embarquent pour un débarquement.", envoi),
        (None, _) => format!("{} troupes partent à la conquête des terres neutres.", envoi),
        (Some(d), _) => format!("{} troupes attaquent {}.", envoi, m.nom_pays(d)),
    };
    if let Some(d) = cible {
        let nom = m.nom_pays(pid);
        m.evenement(Some(d), "alerte", format!("{} lance une offensive sur votre territoire !", nom), Some(i));
    }
    Ok(quoi)
}

/// Rappelle une offensive : ses troupes rentrent dans la reserve.
pub fn rappeler(m: &mut Monde, pid: u32, id: u32) -> Result<String, String> {
    let a = m.attaques.get(&id).filter(|a| a.de == pid).ok_or("Offensive introuvable.")?.clone();
    if a.bateau.is_some() {
        return Err("Les troupes sont en mer : impossible de les rappeler.".into());
    }
    m.attaques.remove(&id);
    if let Some(p) = m.pays.get_mut(&pid) {
        p.troupes += a.troupes;
    }
    Ok(format!("{} troupes rappelées.", a.troupes.floor()))
}

/// Reserve de troupes : remplissage, et retour des troupes au plafond.
pub fn reserves(m: &mut Monde, bl: &HashMap<u32, Bilan>, dt: f64) {
    for (pid, p) in m.pays.iter_mut() {
        if p.elimine {
            p.troupes = 0.0;
            continue;
        }
        let Some(b) = bl.get(pid) else { continue };
        let affame = p.res[NO] <= 0.0 && b.prod[NO] < b.conso[NO];
        p.troupes += croissance(p, b.troupes_max, affame) * dt;
        p.troupes = p.troupes.clamp(0.0, b.troupes_max.max(0.0));
    }
}

/// Fait avancer toutes les offensives de `dt` secondes.
pub fn avancer(m: &mut Monde, dt: f64) {
    let ids: Vec<u32> = m.attaques.keys().copied().collect();
    for id in ids {
        let Some(mut a) = m.attaques.remove(&id) else { continue };
        let fini = avancer_une(m, &mut a, dt);
        if fini {
            if let Some(p) = m.pays.get_mut(&a.de) {
                if !p.elimine {
                    p.troupes += a.troupes.max(0.0);
                }
            }
            if a.prises > 0 {
                let quoi = match a.cible {
                    None => format!("Expansion terminée : {} provinces gagnées.", a.prises),
                    Some(d) => format!("Offensive contre {} terminée : {} provinces prises.", m.nom_pays(d), a.prises),
                };
                m.evenement(Some(a.de), "construction", quoi, Some(a.vise));
            }
        } else {
            m.attaques.insert(id, a);
        }
    }
}

/// Rend true quand l'offensive est terminee.
fn avancer_une(m: &mut Monde, a: &mut Attaque, dt: f64) -> bool {
    if m.pays.get(&a.de).map(|p| p.elimine).unwrap_or(true) {
        a.troupes = 0.0;
        return true;
    }
    // La guerre a pu se terminer (paix signee) : on rentre.
    if let Some(d) = a.cible {
        if !m.en_guerre(a.de, d) || m.pays.get(&d).map(|p| p.elimine).unwrap_or(true) {
            return true;
        }
    }
    // Traversee en bateau, puis prise de la case de debarquement.
    if let Some((plage, reste)) = a.bateau {
        let reste = reste - dt;
        if reste > 0.0 {
            a.bateau = Some((plage, reste));
            return false;
        }
        a.bateau = None;
        if m.cases[plage].proprio != a.cible {
            // La plage a change de main pendant la traversee.
            return m.cases[plage].proprio != Some(a.de) || !prendre_voisines(m, a, dt);
        }
        if !prendre(m, a, plage) {
            m.evenement(Some(a.de), "alerte", "Débarquement repoussé : pas assez de troupes.".into(), Some(plage));
            a.troupes = 0.0;
            return true;
        }
        return false;
    }
    !prendre_voisines(m, a, dt)
}

/// Avance le front ; false s'il ne peut plus avancer.
fn prendre_voisines(m: &mut Monde, a: &mut Attaque, dt: f64) -> bool {
    a.progres += dt * (0.6 + a.troupes / 250.0).min(5.0);
    while a.progres >= 1.0 {
        a.progres -= 1.0;
        let Some(i) = prochaine(m, a) else { return false };
        if !prendre(m, a, i) {
            return false;
        }
    }
    true
}

/// Case du front la plus proche de la case visee.
fn prochaine(m: &Monde, a: &Attaque) -> Option<usize> {
    (0..m.cases.len())
        .filter(|&i| {
            let c = &m.cases[i];
            c.proprio == a.cible && est_terre(c.terrain) && !m.zone_morte(i) && touche(m, a.de, i)
        })
        .min_by_key(|&i| (m.distance(i, a.vise), i))
}

/// Prend la case `i` si les troupes suffisent.
fn prendre(m: &mut Monde, a: &mut Attaque, i: usize) -> bool {
    let mut cout = cout_case(m, i);
    if m.cases[i].proprio.is_none() && m.pays.get(&a.de).map(|p| p.spe == "batisseuse").unwrap_or(false) {
        cout *= 0.75;
    }
    // Produits en stock : armes de l'attaquant, protections du defenseur.
    if let Some(d) = m.cases[i].proprio {
        let att = m.pays.get(&a.de).map(|p| crate::fabrication::effet(&p.stock, "attaque")).unwrap_or(0.0);
        let def = m.pays.get(&d).map(|p| crate::fabrication::effet(&p.stock, "defense")).unwrap_or(0.0);
        cout *= (1.0 - att.min(0.9)) * (1.0 + def);
    }
    if a.troupes < cout {
        return false;
    }
    a.troupes -= cout;
    match m.cases[i].proprio {
        Some(d) => {
            let pertes = 0.8 * densite(m, d) * 0.7;
            if let Some(p) = m.pays.get_mut(&d) {
                p.troupes = (p.troupes - pertes).max(0.0);
            }
            capturer(m, a.de, i);
        }
        None => {
            m.cases[i].proprio = Some(a.de);
            m.toucher(i);
        }
    }
    a.prises += 1;
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jeu::{self, Joueur, Regles};
    use serde_json::json;

    fn monde_deux_pays() -> (Monde, u32, u32, Regles) {
        let mut m = Monde::generer(60, 40, 7);
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let ja = Joueur { user_id: 1, nom: "A", admin: false, triche: false };
        let jb = Joueur { user_id: 2, nom: "B", admin: false, triche: false };
        jeu::commande(&mut m, &ja, &json!({"action": "rejoindre", "nom": "Alpha", "couleur": "#ef4444", "spe": "militaire"}), &regles).unwrap();
        jeu::commande(&mut m, &jb, &json!({"action": "rejoindre", "nom": "Beta", "couleur": "#3b82f6", "spe": "militaire"}), &regles).unwrap();
        let a = jeu::pays_du_joueur(&m, 1).unwrap();
        let b = jeu::pays_du_joueur(&m, 2).unwrap();
        (m, a, b, regles)
    }

    fn neutre_voisine(m: &Monde, pid: u32) -> usize {
        (0..m.cases.len())
            .find(|&i| m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain) && touche(m, pid, i))
            .expect("pas de case neutre voisine")
    }

    #[test]
    fn clic_sur_neutre_agrandit_et_prend_les_troupes() {
        let (mut m, a, _, _) = monde_deux_pays();
        let avant_cases = m.cases.iter().filter(|c| c.proprio == Some(a)).count();
        let avant = m.pays[&a].troupes;
        assert!(avant >= TROUPES_DEPART - 1.0);
        let cible = neutre_voisine(&m, a);
        etendre(&mut m, a, cible, 0.5, 0).unwrap();
        assert!((m.pays[&a].troupes - (avant - (avant * 0.5).floor())).abs() < 1e-6, "les troupes partent de la réserve");
        for _ in 0..30 {
            avancer(&mut m, 1.0);
        }
        let apres_cases = m.cases.iter().filter(|c| c.proprio == Some(a)).count();
        assert!(apres_cases > avant_cases + 5, "{} -> {}", avant_cases, apres_cases);
        assert_eq!(m.cases[cible].proprio, Some(a), "la case cliquée est prise en premier");
    }

    #[test]
    fn pas_d_attaque_sans_guerre_et_conquete_en_guerre() {
        let (mut m, a, b, regles) = monde_deux_pays();
        // Rapproche les deux pays : A prend tout jusqu'a toucher B.
        let case_b = m.pays[&b].capitale;
        let voisine_b = m.voisins(case_b).into_iter().find(|&v| m.cases[v].proprio == Some(b) && est_terre(m.cases[v].terrain)).unwrap();
        // Donne a A une case qui touche B, pour le test.
        let pont = m.voisins(voisine_b).into_iter().find(|&v| m.cases[v].proprio.is_none() && est_terre(m.cases[v].terrain));
        let Some(pont) = pont else { return };
        m.cases[pont].proprio = Some(a);
        assert!(etendre(&mut m, a, voisine_b, 0.5, 0).is_err(), "pas de guerre : refusé");
        let ja = Joueur { user_id: 1, nom: "A", admin: false, triche: false };
        jeu::commande(&mut m, &ja, &json!({"action": "guerre", "pays": b}), &regles).unwrap();
        m.pays.get_mut(&a).unwrap().troupes = 5000.0;
        m.pays.get_mut(&b).unwrap().troupes = 50.0;
        etendre(&mut m, a, voisine_b, 1.0, chrono::Utc::now().timestamp()).unwrap();
        for _ in 0..20 {
            avancer(&mut m, 1.0);
        }
        assert_eq!(m.cases[voisine_b].proprio, Some(a), "province ennemie conquise");
    }

    #[test]
    fn la_reserve_se_remplit_jusqu_au_maximum() {
        let (mut m, a, _, _) = monde_deux_pays();
        m.pays.get_mut(&a).unwrap().troupes = 0.0;
        for _ in 0..2000 {
            let bl = jeu::bilans(&m);
            reserves(&mut m, &bl, 1.0);
        }
        let bl = jeu::bilans(&m);
        let max = bl[&a].troupes_max;
        assert!(m.pays[&a].troupes > max * 0.95 && m.pays[&a].troupes <= max + 1e-6);
    }
}
