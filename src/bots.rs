// ══════════════════════════════════════════════════════════════════
// bots.rs — Nations jouees par l'ordinateur
//
// Un bot est un pays ordinaire dont le « joueur » est l'ordinateur. Il
// agit uniquement via jeu::commande(), exactement comme un humain :
// memes couts, memes delais, memes regles (protection des nouveaux
// venus, capacite territoriale, technologies...). Aucune triche.
//
// Nombre de bots : `bots` dans config.json (0 = aucun). Ils sont
// recrees automatiquement s'ils disparaissent, et refondes quelques
// minutes apres avoir ete aneantis.
// ══════════════════════════════════════════════════════════════════

use crate::defs::*;
use crate::jeu::{self, Bilan, Joueur, Regles};
use crate::monde::*;
use rand::seq::SliceRandom;
use rand::Rng;
use serde_json::json;
use std::collections::{BTreeMap, HashMap};

/// Identifiants des bots : bien en dessous des ids du mode dev
/// (-1 a -1e9), des comptes VEX (positifs) et du mode reseau (>= 2^61).
const BASE_ID: i64 = -2_000_000_000;
/// Un bot reflechit toutes les N secondes de jeu.
const REFLEXION_S: f64 = 6.0;
/// Delai (s de jeu) avant de refonder une nation de bot aneantie.
const DELAI_REFONDATION: f64 = 300.0;

pub const NOMS: &[&str] = &[
    "Royaume d'Astrée", "République de Kalvar", "Empire de Solmar", "Fédération d'Orvanie",
    "Principauté de Veyre", "Union de Tarasque", "Sultanat d'Azhir", "Confédération Boréale",
    "Duché de Montclair", "République de Pélagie", "Khanat de Steppe-Grise", "Royaume de Lysandre",
    "Commonwealth d'Irvane", "Empire de Nérac", "Ligue des Cités Libres", "République d'Ostrava",
];

/// Vrai si le temps de jeu vient de franchir un multiple de `periode`
/// (decale de `phase`) pendant ce tick de duree `dt`.
fn franchi(temps: f64, dt: f64, periode: f64, phase: f64) -> bool {
    ((temps + phase) / periode).floor() != ((temps - dt + phase) / periode).floor()
}

pub fn est_bot(user_id: i64) -> bool {
    user_id <= BASE_ID
}

fn joueur(user_id: i64) -> Joueur<'static> {
    Joueur { user_id, nom: "Ordinateur", admin: false, triche: false }
}

fn cmd(m: &mut Monde, uid: i64, regles: &Regles, v: serde_json::Value) -> bool {
    jeu::commande(m, &joueur(uid), &v, regles).is_ok()
}

/// Cree les bots manquants et refonde ceux qui ont ete aneantis.
pub fn assurer(m: &mut Monde, nb: usize, regles: &Regles, dt: f64) {
    let mut rng = rand::thread_rng();
    for k in 0..nb.min(NOMS.len()) {
        let uid = BASE_ID - k as i64;
        match jeu::pays_du_joueur(m, uid) {
            Some(pid) => {
                let p = &m.pays[&pid];
                if p.elimine && franchi(m.temps, dt, DELAI_REFONDATION, 0.0) {
                    cmd(m, uid, regles, json!({ "action": "refonder" }));
                }
            }
            None => {
                let libres: Vec<&str> = NOMS
                    .iter()
                    .copied()
                    .filter(|n| !m.pays.values().any(|p| p.nom.eq_ignore_ascii_case(n)))
                    .collect();
                let Some(nom) = libres.choose(&mut rng) else { continue };
                let v = json!({
                    "action": "rejoindre",
                    "nom": nom,
                    "couleur": COULEURS_PAYS.choose(&mut rng).unwrap(),
                    "embleme": EMBLEMES.choose(&mut rng).unwrap(),
                    "spe": SPECIALISATIONS.choose(&mut rng).unwrap().id,
                    "devise": "",
                });
                if cmd(m, uid, regles, v) {
                    if let Some(pid) = jeu::pays_du_joueur(m, uid) {
                        m.pays.get_mut(&pid).unwrap().joueur = "Ordinateur".into();
                    }
                }
            }
        }
    }
}

/// Fait jouer les bots dont c'est le tour.
pub fn jouer(m: &mut Monde, regles: &Regles, bl: &HashMap<u32, Bilan>, dt: f64) {
    let bots: Vec<(u32, i64)> = m
        .pays
        .values()
        .filter(|p| est_bot(p.user_id) && !p.elimine)
        .map(|p| (p.id, p.user_id))
        .collect();
    for (pid, uid) in bots {
        // Chaque bot a son propre rythme (decale selon son id).
        let phase = (pid as f64 * 1.7) % REFLEXION_S;
        if !franchi(m.temps, dt, REFLEXION_S, phase) {
            continue;
        }
        let Some(b) = bl.get(&pid) else { continue };
        tour(m, pid, uid, regles, b);
    }
}

fn tour(m: &mut Monde, pid: u32, uid: i64, regles: &Regles, b: &Bilan) {
    let mut rng = rand::thread_rng();
    repondre_propositions(m, pid, uid, regles, b);
    rechercher(m, pid, uid, regles);
    construire(m, pid, uid, regles, b, &mut rng);
    annexer(m, pid, uid, regles, &mut rng);
    armer(m, pid, uid, regles, b);
    guerroyer(m, pid, uid, regles, b, &mut rng);
}

// ── Recherche : la technologie disponible la moins chere ──────────
fn rechercher(m: &mut Monde, pid: u32, uid: i64, regles: &Regles) {
    let p = &m.pays[&pid];
    if p.recherche.is_some() {
        return;
    }
    // La recherche disponible la moins chere, technologie ou amelioration.
    let mut dispo: Vec<(String, f64)> = TECHS
        .iter()
        .filter(|t| t.id != "mil_nucleaire")
        .map(|t| t.id.to_string())
        .chain(AMELIORATIONS.iter().map(|a| format!("am:{}", a.id)))
        .filter_map(|id| jeu::cout_recherche(p, &id).map(|c| (id, c)))
        .collect();
    dispo.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    if let Some((id, _)) = dispo.into_iter().next() {
        cmd(m, uid, regles, json!({ "action": "rechercher", "tech": id }));
    }
}

// ── Economie ───────────────────────────────────────────────────────
fn construire(m: &mut Monde, pid: u32, uid: i64, regles: &Regles, b: &Bilan, rng: &mut impl Rng) {
    let p = &m.pays[&pid];
    if p.chantiers.iter().filter(|c| c.bat != "annexion").count() >= b.slots {
        return;
    }
    let libres: Vec<usize> = (0..m.cases.len())
        .filter(|&i| {
            let c = &m.cases[i];
            c.proprio == Some(pid) && c.bat.is_none() && est_terre(c.terrain) && c.irradiee <= m.temps
                && !p.chantiers.iter().any(|x| x.case == i)
        })
        .collect();
    let net = |r: usize| b.prod[r] - b.conso[r];

    // Priorites, de la plus urgente a la moins urgente.
    let mut voeux: Vec<&str> = Vec::new();
    if b.elec_ratio < 1.0 || b.elec_prod - b.elec_cons < 6.0 {
        voeux.push("centrale_thermique");
    }
    if net(NO) < 8.0 {
        voeux.push("ferme");
    }
    if b.n("mine") < 1.0 + b.cases as f64 / 6.0 {
        voeux.push("mine");
    }
    if b.n("puits_petrole") < 1.0 + b.cases as f64 / 10.0 {
        voeux.push("puits_petrole");
    }
    if b.n("caserne") < 1.0 {
        voeux.push("caserne");
    }
    if b.n("laboratoire") < 1.0 + b.cases as f64 / 8.0 {
        voeux.push("laboratoire");
    }
    if b.cases + 2 >= b.capacite {
        voeux.push("centre_admin");
    }
    if b.n("ville") < b.cases as f64 / 5.0 {
        voeux.push("ville");
    }
    if b.n("usine") < b.cases as f64 / 9.0 {
        voeux.push("usine");
    }
    for extra in ["mine_uranium", "extracteur_tr", "banque", "hopital", "entrepot", "fort"] {
        if b.n(extra) < 1.0 {
            voeux.push(extra);
        }
    }

    for id in voeux {
        let Some(d) = bat(id) else { continue };
        // Deja en chantier : on attend qu'il soit fini avant d'en relancer un.
        if m.pays[&pid].chantiers.iter().any(|c| c.bat == id) {
            continue;
        }
        let mut cases: Vec<usize> = libres
            .iter()
            .copied()
            .filter(|&i| {
                let c = &m.cases[i];
                (d.depot == D_AUCUN && (id != "ferme" || c.depot == D_FERTILE || c.depot == D_AUCUN))
                    || c.depot == d.depot
            })
            .collect();
        // Les gisements sont reserves aux batiments qui les exploitent.
        if d.depot == D_AUCUN && id != "ferme" {
            cases.retain(|&i| m.cases[i].depot == D_AUCUN);
        }
        if id == "ferme" {
            cases.sort_by_key(|&i| if m.cases[i].depot == D_FERTILE { 0 } else { 1 });
        } else {
            cases.shuffle(rng);
        }
        if let Some(&i) = cases.first() {
            if cmd(m, uid, regles, json!({ "action": "construire", "case": i, "bat": id })) {
                return;
            }
        }
    }

    // Plus rien d'urgent a batir : on ameliore.
    let p = &m.pays[&pid];
    let niv_max = jeu::niveau_max(p);
    let mut ameliorables: Vec<usize> = (0..m.cases.len())
        .filter(|&i| {
            let c = &m.cases[i];
            c.proprio == Some(pid) && c.bat.is_some() && c.niv < niv_max && !p.chantiers.iter().any(|x| x.case == i)
        })
        .collect();
    ameliorables.sort_by_key(|&i| {
        let c = &m.cases[i];
        let prio = match c.bat.as_deref() {
            Some("capitale") => 0,
            Some("ferme") | Some("mine") | Some("centrale_thermique") => 1,
            Some("laboratoire") | Some("ville") => 2,
            _ => 3,
        };
        (c.niv, prio)
    });
    for i in ameliorables.into_iter().take(3) {
        if cmd(m, uid, regles, json!({ "action": "ameliorer", "case": i })) {
            return;
        }
    }
}

fn annexer(m: &mut Monde, pid: u32, uid: i64, regles: &Regles, rng: &mut impl Rng) {
    let p = &m.pays[&pid];
    if p.chantiers.iter().filter(|c| c.bat == "annexion").count() >= 2 {
        return;
    }
    let mut cibles: Vec<(usize, i32)> = Vec::new();
    for i in 0..m.cases.len() {
        let c = &m.cases[i];
        if c.proprio.is_some() || !est_terre(c.terrain) || p.chantiers.iter().any(|x| x.case == i) {
            continue;
        }
        let voisins = m.voisins(i);
        let miens = voisins.iter().filter(|&&v| m.cases[v].proprio == Some(pid)).count() as i32;
        if miens == 0 {
            continue;
        }
        // Prefere les cases compactes et les gisements.
        let score = miens * 10 + if c.depot != D_AUCUN { 15 } else { 0 } + rng.gen_range(0..6);
        cibles.push((i, score));
    }
    cibles.sort_by_key(|&(_, s)| -s);
    if let Some(&(i, _)) = cibles.first() {
        cmd(m, uid, regles, json!({ "action": "annexer", "case": i }));
    }
}

// ── Armee ──────────────────────────────────────────────────────────
fn armer(m: &mut Monde, pid: u32, uid: i64, regles: &Regles, b: &Bilan) {
    let p = &m.pays[&pid];
    if p.productions.len() >= 3 {
        return;
    }
    let en_guerre = m.pays.keys().any(|&x| x != pid && m.en_guerre(pid, x));
    let voulu = 6.0 + b.cases as f64 * if en_guerre { 1.6 } else { 0.8 };
    if b.puissance >= voulu {
        return;
    }
    // Ne s'endette pas : garde une reserve pour l'economie.
    if p.res[CR] < 250.0 || b.prod[CR] - b.conso[CR] < 3.0 {
        return;
    }
    let casernes: Vec<(usize, &str)> = (0..m.cases.len())
        .filter(|&i| m.cases[i].proprio == Some(pid))
        .filter_map(|i| match m.cases[i].bat.as_deref() {
            Some("usine_blindes") if p.a("mil_blindes_lourds") => Some((i, "char")),
            Some("usine_blindes") => Some((i, "blinde_leger")),
            Some("caserne") => Some((i, "infanterie")),
            _ => None,
        })
        .collect();
    for (i, u) in casernes {
        if cmd(m, uid, regles, json!({ "action": "produire", "case": i, "unite": u, "qte": 3 })) {
            return;
        }
    }
}

fn guerroyer(m: &mut Monde, pid: u32, uid: i64, regles: &Regles, b: &Bilan, rng: &mut impl Rng) {
    let ennemis: Vec<u32> = m.pays.keys().copied().filter(|&x| x != pid && m.en_guerre(pid, x)).collect();

    if ennemis.is_empty() {
        // Declare parfois la guerre a un voisin plus faible (25 % d'ecart).
        if !rng.gen_bool(0.04) {
            return;
        }
        let voisins = pays_voisins(m, pid);
        let publics = jeu::bilans(m);
        let faible = voisins.into_iter().find(|v| {
            let pv = &m.pays[v];
            !pv.elimine && pv.protection <= chrono::Utc::now().timestamp()
                && publics.get(v).map(|x| x.puissance * 1.25 < b.puissance).unwrap_or(false)
        });
        if let Some(cible) = faible {
            cmd(m, uid, regles, json!({ "action": "guerre", "pays": cible }));
        }
        return;
    }

    // En guerre : chaque armee terrestre au repos marche sur la case
    // ennemie la plus proche. On garde une garnison a la capitale.
    let capitale = m.pays[&pid].capitale;
    // Les renforts rejoignent l'armee de la capitale : on en detache les
    // deux tiers pour le front, le reste garde la capitale.
    let garde: Option<(u32, BTreeMap<String, u32>)> = m
        .armees
        .values()
        .filter(|a| a.proprio == pid && a.case == capitale && a.chemin.is_empty() && a.assaut.is_none()
            && jeu::domaine(a) == DOM_TERRE)
        .max_by_key(|a| a.unites.values().sum::<u32>())
        .map(|a| (a.id, a.unites.clone()));
    if let Some((aid, unites)) = garde {
        if unites.values().sum::<u32>() >= 6 {
            let lot: serde_json::Map<String, serde_json::Value> = unites
                .iter()
                .map(|(t, n)| (t.clone(), json!(n * 2 / 3)))
                .collect();
            cmd(m, uid, regles, json!({ "action": "scinder", "armee": aid, "unites": lot }));
        }
    }
    let armees: Vec<(u32, usize)> = m
        .armees
        .values()
        .filter(|a| a.proprio == pid && a.chemin.is_empty() && a.assaut.is_none() && jeu::domaine(a) == DOM_TERRE)
        .map(|a| (a.id, a.case))
        .collect();
    let cibles: Vec<usize> = (0..m.cases.len())
        .filter(|&i| m.cases[i].proprio.map(|o| ennemis.contains(&o)).unwrap_or(false))
        .filter(|&i| m.voisins(i).iter().any(|&v| m.cases[v].proprio == Some(pid)))
        .collect();
    if cibles.is_empty() {
        return;
    }
    for (aid, depart) in armees {
        let garnison = m.armees.values().filter(|a| a.proprio == pid && a.case == capitale && a.chemin.is_empty()).count();
        if depart == capitale && garnison <= 1 {
            continue;
        }
        let mut tri = cibles.clone();
        tri.sort_by_key(|&c| m.distance(depart, c));
        for c in tri.into_iter().take(3) {
            if cmd(m, uid, regles, json!({ "action": "deplacer", "armee": aid, "cible": c })) {
                break;
            }
        }
    }
}

/// Pays qui touchent le territoire de `pid`.
fn pays_voisins(m: &Monde, pid: u32) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    for i in 0..m.cases.len() {
        if m.cases[i].proprio != Some(pid) {
            continue;
        }
        for v in m.voisins(i) {
            if let Some(o) = m.cases[v].proprio {
                if o != pid && !out.contains(&o) {
                    out.push(o);
                }
            }
        }
    }
    out
}

// ── Diplomatie ─────────────────────────────────────────────────────
fn repondre_propositions(m: &mut Monde, pid: u32, uid: i64, regles: &Regles, b: &Bilan) {
    let props: Vec<(u32, String)> = m.propositions.iter().filter(|x| x.a == pid).map(|x| (x.de, x.genre.clone())).collect();
    if props.is_empty() {
        return;
    }
    let publics = jeu::bilans(m);
    for (de, genre) in props {
        let force_autre = publics.get(&de).map(|x| x.puissance).unwrap_or(0.0);
        let accepte = match genre.as_str() {
            // Paix : acceptee si le bot n'a pas l'avantage.
            "paix" => force_autre * 1.2 >= b.puissance,
            // Pacte : accepte avec les plus forts, refuse avec les faibles.
            _ => force_autre >= b.puissance * 0.7,
        };
        cmd(m, uid, regles, json!({ "action": "repondre", "pays": de, "genre": genre, "accepte": accepte }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un bot nettement plus fort qu'un voisin finit par l'attaquer et
    /// envoie ses armees sur ses provinces.
    #[test]
    fn un_bot_fort_attaque_son_voisin() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 2, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let b = jeu::pays_du_joueur(&m, BASE_ID - 1).unwrap();
        // Donne a B une province collee au territoire de A.
        let cap_a = m.pays[&a].capitale;
        let case_b = m.voisins(cap_a).into_iter()
            .flat_map(|v| m.voisins(v))
            .find(|&i| m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain)
                && m.voisins(i).iter().any(|&v| m.cases[v].proprio == Some(a)))
            .expect("case libre voisine");
        m.cases[case_b].proprio = Some(b);
        // A est bien plus fort.
        for x in m.armees.values_mut().filter(|x| x.proprio == a) {
            x.unites.insert("infanterie".into(), 60);
        }
        m.pays.get_mut(&a).unwrap().influence = 100.0;
        let mut rng = rand::thread_rng();
        for _ in 0..400 {
            let bl = jeu::bilans(&m);
            guerroyer(&mut m, a, BASE_ID, &regles, &bl[&a], &mut rng);
            if m.en_guerre(a, b) { break; }
        }
        assert!(m.en_guerre(a, b), "le bot aurait du declarer la guerre");
        let bl = jeu::bilans(&m);
        guerroyer(&mut m, a, BASE_ID, &regles, &bl[&a], &mut rng);
        assert!(m.armees.values().any(|x| x.proprio == a && !x.chemin.is_empty()), "aucune armee en marche");
        assert!(m.armees.values().any(|x| x.proprio == a && x.case == cap_a && x.chemin.is_empty()), "capitale laissee sans garnison");
    }

    /// Sans « Nucleaire civil », une centrale finit tot ou tard par avoir
    /// un accident : centrale detruite, zone irradiee, nuage qui derive.
    #[test]
    fn accident_nucleaire_sans_technologie() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let case = m.voisins(m.pays[&a].capitale).into_iter().find(|&v| m.cases[v].proprio == Some(a)).unwrap();
        let mut accident = false;
        for _ in 0..60 {
            m.cases[case].bat = None;
            let id = m.nouvel_id();
            let p = m.pays.get_mut(&a).unwrap();
            p.chantiers.clear();
            p.chantiers.push(Chantier { id, case, bat: "centrale_nucleaire".into(), niv: 1, reste: 0.1, total: 120.0, cmdt: None });
            jeu::tick(&mut m, 1.0);
            if !m.nuages.is_empty() { accident = true; break; }
            assert_eq!(m.cases[case].bat.as_deref(), Some("centrale_nucleaire"));
        }
        assert!(accident, "aucun accident en 60 mises en service a 25 %");
        assert!(m.cases[case].bat.is_none() && m.cases[case].irradiee > m.temps);
        let depart = m.nuages[0].case;
        for _ in 0..40 { jeu::tick(&mut m, 1.0); }
        assert!(m.nuages.is_empty() || m.nuages[0].case != depart, "le nuage n'a pas bouge");
    }

    /// Une poche neutre entierement encerclee revient a la nation qui
    /// l'entoure, sauf si des troupes etrangeres s'y trouvent.
    #[test]
    fn encerclement() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 2, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let b = jeu::pays_du_joueur(&m, BASE_ID - 1).unwrap();
        // Deux cases de terre neutres entourees de terre neutre.
        let libres: Vec<usize> = (0..m.cases.len())
            .filter(|&i| m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain)
                && m.voisins(i).len() == 6
                && m.voisins(i).iter().all(|&v| est_terre(m.cases[v].terrain) && m.cases[v].proprio.is_none()
                    && m.voisins(v).len() == 6))
            .collect();
        let (p1, p2) = (libres[0], *libres.iter().find(|&&x| m.distance(x, libres[0]) > 4).unwrap());
        for &c in &[p1, p2] {
            for v in m.voisins(c) {
                m.cases[v].proprio = Some(a);
            }
        }
        // Une armee de B dans la seconde poche.
        let id = m.nouvel_id();
        m.armees.insert(id, Armee { id, proprio: b, case: p2, unites: [("infanterie".to_string(), 3)].into_iter().collect(),
            blessures: Default::default(), chemin: vec![], progres: 0.0, bombarde: None, assaut: None, nom: "test".into() });
        for _ in 0..6 { jeu::tick(&mut m, 1.0); }
        assert_eq!(m.cases[p1].proprio, Some(a), "la poche encerclee n'a pas ete prise");
        assert_eq!(m.cases[p2].proprio, None, "poche prise malgre des troupes etrangeres");
    }

    /// Une poche adossee a la mer est prise si la nation la borde bien,
    /// mais pas un bout d'ile touche en un seul point.
    #[test]
    fn encerclement_contre_la_mer() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        // Case de terre neutre cotiere : 1 a 3 voisins marins, le reste terre neutre.
        let c = (0..m.cases.len()).find(|&i| m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain)
            && m.voisins(i).len() == 6
            && { let v = m.voisins(i); let eau = v.iter().filter(|&&x| !est_terre(m.cases[x].terrain)).count();
                 (1..=3).contains(&eau) && v.iter().all(|&x| m.cases[x].proprio.is_none()) }).unwrap();
        for v in m.voisins(c) {
            if est_terre(m.cases[v].terrain) { m.cases[v].proprio = Some(a); }
        }
        // Ces nouvelles cases ferment la poche de 1 case contre la mer.
        let terres: Vec<usize> = m.voisins(c).into_iter().filter(|&v| est_terre(m.cases[v].terrain)).collect();
        for _ in 0..6 { jeu::tick(&mut m, 1.0); }
        assert_eq!(m.cases[c].proprio, Some(a), "poche cotiere non prise ({} voisins de terre)", terres.len());
    }

    /// Conquête : il faut un commandant libre et des hommes ; la durée dépend
    /// de sa vitesse, il mange plus en campagne, puis avance sur la case prise.
    #[test]
    fn conquete_avec_commandant() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        m.pays.get_mut(&a).unwrap().chantiers.clear();
        assert_eq!(m.pays[&a].commandants.len(), 1, "un commandant a la fondation");
        let cd = m.pays[&a].commandants[0].clone();
        let cible = (0..m.cases.len()).find(|&i| m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain)
            && m.voisins(i).iter().any(|&v| m.cases[v].proprio == Some(a))).unwrap();
        let autre = (0..m.cases.len()).find(|&i| i != cible && m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain)
            && m.voisins(i).iter().any(|&v| m.cases[v].proprio == Some(a))).unwrap();
        let j = joueur(BASE_ID);
        let pop0 = m.pays[&a].pop;
        let nourriture0 = jeu::bilans(&m)[&a].conso[NO];
        jeu::commande(&mut m, &j, &json!({ "action": "annexer", "case": cible }), &regles).unwrap();
        assert!((pop0 - m.pays[&a].pop - jeu::HOMMES_ANNEXION).abs() < 1e-6, "les hommes partent");
        assert!(jeu::bilans(&m)[&a].conso[NO] > nourriture0, "la campagne consomme de la nourriture");
        // Un seul commandant : pas de seconde conquete en parallele.
        assert!(jeu::commande(&mut m, &j, &json!({ "action": "annexer", "case": autre }), &regles).is_err());
        let duree = jeu::duree_annexion(cd.vitesse);
        let mut t = 0.0;
        while m.cases[cible].proprio.is_none() && t < duree + 5.0 {
            m.pays.get_mut(&a).unwrap().res[NO] = 5000.0;
            jeu::tick(&mut m, 1.0);
            t += 1.0;
        }
        assert_eq!(m.cases[cible].proprio, Some(a));
        assert!((t - duree).abs() <= 2.0, "duree {} au lieu de {}", t, duree);
        assert_eq!(m.pays[&a].commandants[0].case, cible, "le commandant avance sur la case prise");
    }

    /// Une province cotiere qui ne touche pas le pays se conquiert si une
    /// flotte est juste a cote -- et reste acquise si la flotte repart.
    #[test]
    fn conquete_depuis_la_mer() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        m.pays.get_mut(&a).unwrap().chantiers.clear();
        let (cible, mer) = (0..m.cases.len())
            .filter(|&i| m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain)
                && !m.voisins(i).iter().any(|&v| m.cases[v].proprio.is_some()))
            .find_map(|i| m.voisins(i).into_iter().find(|&v| !est_terre(m.cases[v].terrain)).map(|v| (i, v)))
            .expect("cote neutre isolee");
        let j = joueur(BASE_ID);
        let r = jeu::commande(&mut m, &j, &json!({ "action": "annexer", "case": cible }), &regles);
        assert!(r.is_err(), "sans flotte, la province ne doit pas etre annexable");
        let aid = m.armees.values().find(|x| x.proprio == a).map(|x| x.id).expect("une armee");
        {
            let ar = m.armees.get_mut(&aid).unwrap();
            ar.unites = [("fregate".to_string(), 1u32)].into_iter().collect();
            ar.case = mer;
            ar.chemin.clear();
        }
        let r = jeu::commande(&mut m, &j, &json!({ "action": "annexer", "case": cible }), &regles);
        assert!(r.is_ok(), "avec une flotte a cote : {:?}", r);
        // La flotte repart : la conquete doit quand meme aboutir.
        m.armees.get_mut(&aid).unwrap().case = m.pays[&a].capitale;
        for _ in 0..200 {
            m.pays.get_mut(&a).unwrap().res[NO] = 5000.0;
            jeu::tick(&mut m, 1.0);
            if m.cases[cible].proprio.is_some() { break; }
        }
        assert_eq!(m.cases[cible].proprio, Some(a), "province cotiere non acquise");
    }

    /// Le centre d'enrichissement transforme 1,5 uranium brut en 1 enrichi.
    #[test]
    fn enrichissement_uranium() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let case = m.voisins(m.pays[&a].capitale).into_iter().find(|&v| m.cases[v].proprio == Some(a)).unwrap();
        m.cases[case].bat = Some("enrichissement".into());
        m.cases[case].niv = 2;
        m.pays.get_mut(&a).unwrap().res[UR] = 30.0;
        jeu::tick(&mut m, 60.0);
        let p = &m.pays[&a];
        assert!(p.ur_enrichi > 0.5, "rien d'enrichi : {}", p.ur_enrichi);
        assert!((30.0 - p.res[UR] - p.ur_enrichi * 1.5).abs() < 0.01);
    }

    /// Chaine nucleaire complete, par les memes commandes que le joueur :
    /// silo -> missile nucleaire -> guerre -> tir -> impact.
    #[test]
    fn frappe_nucleaire_de_bout_en_bout() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 2, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let b = jeu::pays_du_joueur(&m, BASE_ID - 1).unwrap();
        {
            let p = m.pays.get_mut(&a).unwrap();
            for t in ["mil_missiles", "mil_balistique", "mil_nucleaire"] {
                p.techs.push(t.into());
            }
            for r in p.res.iter_mut() {
                *r = 1e7;
            }
        }
        let j = joueur(BASE_ID);
        let case = m.voisins(m.pays[&a].capitale).into_iter()
            .find(|&v| m.cases[v].proprio == Some(a) && m.cases[v].bat.is_none() && est_terre(m.cases[v].terrain))
            .expect("case libre");
        let r = jeu::commande(&mut m, &j, &json!({ "action": "construire", "case": case, "bat": "silo" }), &regles);
        assert!(r.is_ok(), "construire silo : {:?}", r);
        for _ in 0..400 { jeu::tick(&mut m, 1.0); }
        assert_eq!(m.cases[case].bat.as_deref(), Some("silo"), "silo non construit");
        let r = jeu::commande(&mut m, &j, &json!({ "action": "produire", "case": case, "unite": "missile_nucleaire" }), &regles);
        assert!(r.is_ok(), "produire : {:?}", r);
        for _ in 0..600 { jeu::tick(&mut m, 1.0); }
        let aid = m.armees.values()
            .find(|x| x.proprio == a && x.unites.contains_key("missile_nucleaire"))
            .map(|x| x.id)
            .expect("missile nucleaire introuvable apres production");
        let r = jeu::commande(&mut m, &j, &json!({ "action": "guerre", "pays": b }), &regles);
        assert!(r.is_ok(), "guerre : {:?}", r);
        let cible = m.pays[&b].capitale;
        let r = jeu::commande(&mut m, &j, &json!({ "action": "missile", "armee": aid, "genre": "missile_nucleaire", "cible": cible }), &regles);
        assert!(r.is_ok(), "tir : {:?}", r);
        for _ in 0..600 { jeu::tick(&mut m, 1.0); }
        assert!(m.missiles.is_empty(), "missile toujours en vol");
        assert!(m.cases[cible].irradiee > m.temps, "cible non irradiee");
    }
}
