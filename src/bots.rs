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
/// Aucune guerre declaree par un bot pendant les 20 premieres minutes de jeu.
const PAIX_INITIALE_S: f64 = 1200.0;
/// Delai (s de jeu) avant de refonder une nation de bot aneantie.

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

/// Rang d'un bot (0 pour le premier cree), pour en retirer depuis l'admin.
pub fn rang_bot(user_id: i64) -> usize {
    (BASE_ID - user_id).max(0) as usize
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
/// Les bots ne sont crees qu'au debut d'une partie (2 premieres minutes) :
/// ils n'apparaissent plus en cours de jeu et ne se refondent pas une fois
/// elimines. Le nombre se regle dans l'administration.
pub const FENETRE_BOTS: f64 = 120.0;

pub fn assurer(m: &mut Monde, nb: usize, regles: &Regles, dt: f64) {
    let _ = dt;
    if m.temps <= FENETRE_BOTS {
        creer(m, nb, regles);
    }
}

/// Cree les bots manquants (debut de partie, ou demande de l'admin).
pub fn creer(m: &mut Monde, nb: usize, regles: &Regles) {
    let mut rng = rand::thread_rng();
    for k in 0..nb.min(NOMS.len()) {
        let uid = BASE_ID - k as i64;
        match jeu::pays_du_joueur(m, uid) {
            Some(_) => {}
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
    etendre(m, pid, uid, regles, b, &mut rng);
    fabriquer(m, pid, uid, regles, b);
    armer(m, pid, uid, regles, b);
    guerroyer(m, pid, uid, regles, b, &mut rng);
}

// ── Recherche : la technologie disponible la moins chere ──────────
fn rechercher(m: &mut Monde, pid: u32, uid: i64, regles: &Regles) {
    // Credits en trop : le plan le moins cher au marche.
    let p = &m.pays[&pid];
    let plan = TECHS
        .iter()
        .filter(|t| t.id != "mil_nucleaire")
        .filter_map(|t| jeu::prix_plan(p, t.id).map(|c| (t.id, c)))
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    if let Some((id, prix)) = plan {
        if p.res[CR] > (prix * 2.0).max(1500.0) {
            cmd(m, uid, regles, json!({ "action": "acheter_plan", "plan": id }));
        }
    }
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

    // Des credits mais plus de minerai commun : on en achete au marche.
    if p.res[ME] < 150.0 && p.res[CR] > 600.0 {
        let qte = ((p.res[CR] - 300.0) / (m.prix[ME] * 1.1)).floor().clamp(0.0, 400.0);
        if qte >= 20.0 {
            cmd(m, uid, regles, json!({ "action": "marche", "res": ME, "sens": "achat", "qte": qte }));
        }
    }

    // Priorites, de la plus urgente a la moins urgente.
    let mut voeux: Vec<&str> = Vec::new();
    if b.elec_ratio < 1.0 || b.elec_prod - b.elec_cons < 6.0 {
        voeux.push("centrale_thermique");
    }
    if false && net(NO) < 8.0 {
        voeux.push("ferme");
    }
    // Objectifs plafonnes : un grand territoire ne doit pas viser 150 mines.
    let selon = |div: f64, max: f64| (1.0 + b.cases as f64 / div).min(max);
    if b.n("mine") < selon(6.0, 14.0) {
        voeux.push("mine");
    }
    if b.n("carriere") < selon(12.0, 8.0) {
        voeux.push("carriere");
    }
    if b.n("caserne") < 1.0 {
        voeux.push("caserne");
    }
    if b.cases > 25 && b.n("raffinerie") < selon(60.0, 4.0) {
        voeux.push("raffinerie");
    }
    if b.n("laboratoire") < selon(8.0, 10.0) {
        voeux.push("laboratoire");
    }
    if b.cases + 2 >= b.capacite {
        voeux.push("centre_admin");
    }
    if b.n("ville") < selon(5.0, 20.0) - 1.0 {
        voeux.push("ville");
    }
    if b.n("usine") < selon(9.0, 8.0) - 1.0 {
        voeux.push("usine");
    }
    for extra in ["mine_uranium", "extracteur_tr", "banque", "hopital", "entrepot", "fort"] {
        if b.n(extra) < 1.0 {
            voeux.push(extra);
        }
    }

    // Electricite insuffisante : tout tourne au ralenti. On economise pour
    // une centrale plutot que de depenser dans autre chose.
    let manque_elec = b.elec_ratio < 0.9;
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
        // Les gisements sont reserves aux batiments qui les exploitent, sauf
        // pour la carriere qui en tire le minerai (rare, radioactif, legendaire).
        if id == "carriere" {
            let precieux = |i: usize| matches!(m.cases[i].depot, D_TERRES_RARES | D_URANIUM | D_METEORITE);
            let tous: Vec<usize> = libres.iter().copied().filter(|&i| m.cases[i].depot == D_AUCUN || precieux(i)).collect();
            cases = tous.iter().copied().filter(|&i| precieux(i)).collect();
            if cases.is_empty() {
                cases = tous;
            }
        } else if d.depot == D_AUCUN && id != "ferme" {
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
        // Pas de quoi payer la centrale : on garde les credits pour elle.
        if manque_elec && id == "centrale_thermique" {
            return;
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

// ── Expansion : une part des troupes vers les terres neutres ──────
fn etendre(m: &mut Monde, pid: u32, uid: i64, regles: &Regles, b: &Bilan, rng: &mut impl Rng) {
    let p = &m.pays[&pid];
    if p.troupes < 0.45 * b.troupes_max || m.attaques.values().any(|a| a.de == pid && a.cible.is_none()) {
        return;
    }
    // Les bots laissent toujours de la place aux joueurs : ils arretent de
    // s'etendre quand il reste moins d'un tiers de terres neutres.
    let terres = m.cases.iter().filter(|c| est_terre(c.terrain)).count().max(1);
    let neutres = m.cases.iter().filter(|c| est_terre(c.terrain) && c.proprio.is_none()).count();
    if neutres * 3 < terres {
        return;
    }
    let mut cibles: Vec<(usize, i32)> = Vec::new();
    for i in 0..m.cases.len() {
        let c = &m.cases[i];
        if c.proprio.is_some() || !est_terre(c.terrain) {
            continue;
        }
        let miens = m.voisins(i).iter().filter(|&&v| m.cases[v].proprio == Some(pid)).count() as i32;
        if miens == 0 {
            continue;
        }
        // Prefere les gisements, puis les cases compactes.
        let score = miens * 10 + if c.depot != D_AUCUN { 15 } else { 0 } + rng.gen_range(0..6);
        cibles.push((i, score));
    }
    cibles.sort_by_key(|&(_, s)| -s);
    if let Some(&(i, _)) = cibles.first() {
        cmd(m, uid, regles, json!({ "action": "etendre", "case": i, "ratio": 0.35 }));
    }
}

// ── Fabrication : les bots se constituent des bonus ───────────────
/// Produits qui donnent un bonus, du plus puissant au plus simple : le bot
/// lance la chaine complete du premier qu'il peut s'offrir.
fn fabriquer(m: &mut Monde, pid: u32, uid: i64, regles: &Regles, b: &Bilan) {
    use crate::fabrication as fab;
    let p = &m.pays[&pid];
    if b.fab_max == 0 || b.n("raffinerie") <= 0.0 || p.fabrications.len() >= 3 {
        return;
    }
    let mut choix: Vec<&fab::ProduitDef> = fab::tous_produits()
        .filter(|d| d.niveau <= b.fab_max && fab::effet_de(d.id).is_some())
        .filter(|d| {
            // Inutile de depasser le plafond du bonus.
            let e = fab::effet_de(d.id).unwrap();
            fab::qte(&p.stock, d.id) * e.par_unite < e.max
        })
        .collect();
    choix.sort_by_key(|d| std::cmp::Reverse(d.niveau));
    for d in choix.into_iter().take(12) {
        if cmd(m, uid, regles, json!({ "action": "fabriquer_chaine", "objet": d.id, "qte": 2 })) {
            return;
        }
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
        // Paix des 20 premieres minutes, puis guerre de temps en temps (en
        // moyenne une fois toutes les 8 min) contre un voisin NETTEMENT plus
        // faible : les bots ne s'eliminent plus en une heure.
        if m.temps < PAIX_INITIALE_S || !rng.gen_bool(0.012) {
            return;
        }
        let voisins = pays_voisins(m, pid);
        let publics = jeu::bilans(m);
        let faible = voisins.into_iter().find(|v| {
            let pv = &m.pays[v];
            !pv.elimine && pv.protection <= chrono::Utc::now().timestamp()
                && publics.get(v).map(|x| x.puissance * 1.6 < b.puissance).unwrap_or(false)
        });
        if let Some(cible) = faible {
            cmd(m, uid, regles, json!({ "action": "guerre", "pays": cible }));
        }
        return;
    }

    // Lassitude : de temps en temps, le bot propose la paix (meme s'il gagne).
    if rng.gen_bool(0.015) {
        let e = ennemis[rng.gen_range(0..ennemis.len())];
        if !m.propositions.iter().any(|x| x.de == pid && x.a == e) {
            cmd(m, uid, regles, json!({ "action": "proposer", "pays": e, "genre": "paix" }));
        }
    }
    // En guerre : un tiers des troupes part a l'offensive (une a la fois).
    let p = &m.pays[&pid];
    if p.troupes > 0.6 * b.troupes_max && !m.attaques.values().any(|a| a.de == pid && a.cible.is_some()) {
        let front: Option<usize> = (0..m.cases.len())
            .filter(|&i| m.cases[i].proprio.map(|o| ennemis.contains(&o)).unwrap_or(false))
            .find(|&i| m.voisins(i).iter().any(|&v| m.cases[v].proprio == Some(pid)));
        if let Some(i) = front {
            cmd(m, uid, regles, json!({ "action": "etendre", "case": i, "ratio": 0.35 }));
        }
    }
    // Et chaque armee terrestre au repos marche sur la case ennemie la plus
    // proche. On garde une garnison a la capitale.
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
    let mut rng = rand::thread_rng();
    for (de, genre) in props {
        let force_autre = publics.get(&de).map(|x| x.puissance).unwrap_or(0.0);
        let accepte = match genre.as_str() {
            // Paix : acceptee si le bot n'a pas l'avantage, et parfois meme
            // s'il gagne (une guerre ne doit pas finir en elimination).
            "paix" => force_autre * 1.2 >= b.puissance || rng.gen_bool(0.35),
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
        // Apres la paix initiale.
        m.temps = PAIX_INITIALE_S + 1.0;
        for _ in 0..1500 {
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
            p.chantiers.push(Chantier { id, case, bat: "centrale_nucleaire".into(), niv: 1, reste: 0.1, total: 120.0 });
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

    /// Les bots s'etendent avec leurs troupes, sans commandant.
    #[test]
    fn un_bot_s_etend_avec_ses_troupes() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let avant = m.cases.iter().filter(|c| c.proprio == Some(a)).count();
        for _ in 0..240 {
            let bl = jeu::tick(&mut m, 1.0);
            jouer(&mut m, &regles, &bl, 1.0);
        }
        let apres = m.cases.iter().filter(|c| c.proprio == Some(a)).count();
        assert!(apres > avant + 5, "le bot ne s'est pas etendu : {} -> {}", avant, apres);
    }

    /// Une cote qui ne touche pas le pays se prend par debarquement depuis
    /// un chantier naval, et reste acquise.
    #[test]
    fn debarquement_depuis_un_port() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let cap = m.pays[&a].capitale;
        // Cote isolee hors de portee sans port (plus de PORTEE_COTE cases).
        let cible = (0..m.cases.len())
            .filter(|&i| m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain) && m.est_cote(i)
                && !m.voisins(i).iter().any(|&v| m.cases[v].proprio.is_some())
                && m.distance(i, cap) > crate::front::PORTEE_COTE + 2)
            .min_by_key(|&i| m.distance(i, cap))
            .expect("cote neutre isolee");
        let j = joueur(BASE_ID);
        let r = jeu::commande(&mut m, &j, &json!({ "action": "etendre", "case": cible, "ratio": 0.5 }), &regles);
        assert!(r.is_err(), "sans chantier naval, pas de debarquement");
        m.cases[cap].bat = Some("port".into());
        m.pays.get_mut(&a).unwrap().troupes = 2000.0;
        let r = jeu::commande(&mut m, &j, &json!({ "action": "etendre", "case": cible, "ratio": 0.5 }), &regles);
        if m.distance(cap, cible) > crate::front::PORTEE_BATEAU {
            assert!(r.is_err());
            return;
        }
        assert!(r.is_ok(), "debarquement : {:?}", r);
        for _ in 0..120 {
            m.pays.get_mut(&a).unwrap().res[NO] = 5000.0;
            jeu::tick(&mut m, 1.0);
            if m.cases[cible].proprio.is_some() { break; }
        }
        assert_eq!(m.cases[cible].proprio, Some(a), "cote non prise");
    }

    /// Une terre proche de l'autre cote de la mer se prend sans chantier naval.
    #[test]
    fn traversee_d_un_bras_de_mer() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        // Une cote du pays, et une terre neutre a 3 cases qui ne la touche pas.
        let mes_cotes: Vec<usize> = (0..m.cases.len()).filter(|&i| m.cases[i].proprio == Some(a) && m.est_cote(i)).collect();
        let Some((cible, _)) = (0..m.cases.len())
            .filter(|&i| m.cases[i].proprio.is_none() && est_terre(m.cases[i].terrain) && m.est_cote(i)
                && !m.voisins(i).iter().any(|&v| m.cases[v].proprio == Some(a)))
            .filter_map(|i| mes_cotes.iter().map(|&k| m.distance(k, i)).min().map(|d| (i, d)))
            .find(|&(_, d)| (2..=crate::front::PORTEE_COTE).contains(&d))
        else { return };
        m.pays.get_mut(&a).unwrap().troupes = 2000.0;
        let j = joueur(BASE_ID);
        let r = jeu::commande(&mut m, &j, &json!({ "action": "etendre", "case": cible, "ratio": 0.5 }), &regles);
        assert!(r.is_ok(), "traversee : {:?}", r);
        for _ in 0..60 {
            m.pays.get_mut(&a).unwrap().res[NO] = 5000.0;
            jeu::tick(&mut m, 1.0);
            if m.cases[cible].proprio.is_some() { break; }
        }
        assert_eq!(m.cases[cible].proprio, Some(a));
    }

    /// Monde entierement pris par les bots : un joueur peut quand meme fonder
    /// sa nation (sur des terres reprises a un bot).
    #[test]
    fn fonder_quand_les_bots_ont_tout_pris() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(60, 40, 7);
        assurer(&mut m, 2, &regles, 0.0);
        let bot = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        for c in m.cases.iter_mut() {
            if est_terre(c.terrain) && c.proprio.is_none() {
                c.proprio = Some(bot);
            }
        }
        let j = Joueur { user_id: 42, nom: "Humain", admin: false, triche: false };
        let r = jeu::commande(&mut m, &j, &json!({ "action": "rejoindre", "nom": "Humania", "couleur": "#ef4444", "spe": "militaire" }), &regles);
        assert!(r.is_ok(), "fondation : {:?}", r);
        let h = jeu::pays_du_joueur(&m, 42).unwrap();
        assert!(m.cases.iter().filter(|c| c.proprio == Some(h)).count() >= 2);
    }

    /// Lignes automatiques : en parallele (une par niveau), relancees seules
    /// tant qu'il y a du minerai, arretees au stock vise.
    #[test]
    fn lignes_automatiques_en_parallele() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let j = joueur(BASE_ID);
        let c = m.voisins(m.pays[&a].capitale).into_iter().find(|&v| m.cases[v].proprio == Some(a)).unwrap();
        m.cases[c].bat = Some("raffinerie".into());
        m.cases[c].niv = 2;
        m.pays.get_mut(&a).unwrap().res[ME] = 1000.0;
        jeu::commande(&mut m, &j, &json!({ "action": "raffiner", "objet": "Fe", "qte": 1, "auto": true, "cible": 6 }), &regles).unwrap();
        jeu::commande(&mut m, &j, &json!({ "action": "raffiner", "objet": "C", "qte": 1, "auto": true }), &regles).unwrap();
        for _ in 0..120 { jeu::tick(&mut m, 1.0); }
        let p = &m.pays[&a];
        let fe = crate::fabrication::qte(&p.stock, "Fe");
        let c_ = crate::fabrication::qte(&p.stock, "C");
        assert!((6.0..=7.0).contains(&fe), "fer arrete a 6 : {}", fe);
        assert!(c_ > 6.0, "les deux lignes tournent en parallele : C = {}", c_);
        assert_eq!(p.fabrications.len(), 2, "les lignes automatiques restent");
    }

    /// Une carriere sur un gisement radioactif extrait du minerai radioactif.
    #[test]
    fn carriere_sur_gisement_radioactif() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let c = m.voisins(m.pays[&a].capitale).into_iter().find(|&v| m.cases[v].proprio == Some(a)).unwrap();
        m.cases[c].depot = D_URANIUM;
        m.cases[c].bat = Some("carriere".into());
        m.cases[c].niv = 2;
        let b = &jeu::bilans(&m)[&a];
        assert!(b.prod[UR] > 2.9, "minerai radioactif : {}", b.prod[UR]);
    }

    /// « Tout fabriquer » : depuis du minerai seul, la chaine raffine puis
    /// assemble tout jusqu'au produit voulu.
    #[test]
    fn fabrication_en_chaine() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let j = joueur(BASE_ID);
        let cases: Vec<usize> = m.voisins(m.pays[&a].capitale).into_iter().filter(|&v| m.cases[v].proprio == Some(a)).collect();
        m.cases[cases[0]].bat = Some("raffinerie".into());
        m.cases[cases[0]].niv = 4;
        m.cases[cases[1]].bat = Some("usine".into());
        m.cases[cases[1]].niv = 2;
        m.pays.get_mut(&a).unwrap().res[ME] = 5000.0;
        m.pays.get_mut(&a).unwrap().res[TR] = 5000.0;
        // Tole blindee (niv 2) : acier (Fe + C) + manganese. Un simple
        // « fabriquer » sans les elements lance toute la chaine.
        let r = jeu::commande(&mut m, &j, &json!({ "action": "fabriquer", "objet": "tole_blindee", "qte": 2 }), &regles);
        assert!(r.is_ok(), "chaine : {:?}", r);
        for _ in 0..600 {
            jeu::tick(&mut m, 1.0);
            if crate::fabrication::qte(&m.pays[&a].stock, "tole_blindee") >= 4.0 { break; }
        }
        assert!(crate::fabrication::qte(&m.pays[&a].stock, "tole_blindee") >= 4.0, "2 lots x 2 toles");
        assert!(m.pays[&a].fabrications.is_empty(), "toutes les etapes sont finies");
    }

    /// Admin : « Tout donner » marche dans tous les modes, dons precis.
    #[test]
    fn admin_dons() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(60, 40, 7);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let admin = Joueur { user_id: BASE_ID, nom: "Admin", admin: true, triche: true };
        jeu::commande(&mut m, &admin, &json!({ "action": "dev_tout" }), &regles).unwrap();
        assert!(m.pays[&a].techs.len() > 10);
        // « Tout me donner » : le maximum (1 000 de chaque produit).
        assert_eq!(crate::fabrication::qte(&m.pays[&a].stock, "robot"), 1000.0);
        jeu::commande(&mut m, &admin, &json!({ "action": "admin_donner", "pays": a, "objet": "robot", "qte": 7, "troupes": 100 }), &regles).unwrap();
        assert_eq!(crate::fabrication::qte(&m.pays[&a].stock, "robot"), 1007.0);
        // Un don au-dessus de la capacite de stockage n'est plus perdu.
        jeu::commande(&mut m, &admin, &json!({ "action": "admin_donner", "pays": a, "res": [0, 0, 50000, 0, 0, 0] }), &regles).unwrap();
        let avant = m.pays[&a].res[ME];
        for _ in 0..10 { jeu::tick(&mut m, 1.0); }
        assert!(m.pays[&a].res[ME] > avant - 50.0 && avant > 40000.0, "don garde : {} -> {}", avant, m.pays[&a].res[ME]);
        let normal = Joueur { user_id: 99, nom: "X", admin: false, triche: false };
        assert!(jeu::commande(&mut m, &normal, &json!({ "action": "admin_donner", "pays": a, "objet": "robot", "qte": 7 }), &regles).is_err());
    }

    /// Simulation d'une heure avec 6 bots (equilibre de l'economie) :
    /// `cargo test --release simulation_economie -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn simulation_economie() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(128, 80, 12345);
        assurer(&mut m, 6, &regles, 0.0);
        for t in 0..3600 {
            let bl = jeu::tick(&mut m, 1.0);
            jouer(&mut m, &regles, &bl, 1.0);
            assurer(&mut m, 6, &regles, 1.0);
            if t % 900 == 899 {
                let bl = jeu::bilans(&m);
                println!("── {} min", (t + 1) / 60);
                for p in m.pays.values().filter(|p| !p.elimine) {
                    let b = &bl[&p.id];
                    println!("{:<14} cases {:>4} cr {:>7.0} (+{:>5.1}/min) commun {:>6.0} rare {:>5.0} radio {:>5.0} pop {:>5.0} troupes {:>5.0}/{:>5.0} techs {:>2} elec {:>4.0}/{:>4.0} bat {} produits {:.0}",
                        p.nom, b.cases, p.res[CR], b.prod[CR] - b.conso[CR], p.res[ME], p.res[TR], p.res[UR], p.pop, p.troupes, b.troupes_max, p.techs.len(), b.elec_prod, b.elec_cons, b.niv.values().sum::<u32>(), p.stock.iter().filter(|(k, _)| crate::fabrication::produit(k).is_some()).map(|(_, v)| v).sum::<f64>());
                }
            }
        }
    }

    /// Un bot avec raffinerie et complexe industriel fabrique des produits a bonus.
    #[test]
    fn un_bot_fabrique() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let cases: Vec<usize> = m.voisins(m.pays[&a].capitale).into_iter().filter(|&v| m.cases[v].proprio == Some(a)).collect();
        m.cases[cases[0]].bat = Some("raffinerie".into());
        m.cases[cases[0]].niv = 3;
        m.cases[cases[1]].bat = Some("usine".into());
        m.cases[cases[1]].niv = 2;
        m.pays.get_mut(&a).unwrap().res[ME] = 3000.0;
        let b = jeu::bilans(&m).remove(&a).unwrap();
        fabriquer(&mut m, a, BASE_ID, &regles, &b);
        assert!(!m.pays[&a].fabrications.is_empty(), "le bot lance une chaine");
        for _ in 0..400 { jeu::tick(&mut m, 1.0); }
        let bonus = crate::fabrication::tous_effets().any(|e| crate::fabrication::qte(&m.pays[&a].stock, e.produit) > 0.0);
        assert!(bonus, "le bot possede un produit a bonus");
    }

    /// Plans au marche, et alliance proposee puis acceptee.
    #[test]
    fn plans_et_alliance() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 2, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let b = jeu::pays_du_joueur(&m, BASE_ID - 1).unwrap();
        let ja = joueur(BASE_ID);
        let jb = joueur(BASE_ID - 1);
        let prix = jeu::prix_plan(&m.pays[&a], "mil_blindes").unwrap();
        m.pays.get_mut(&a).unwrap().res[CR] = prix;
        jeu::commande(&mut m, &ja, &json!({ "action": "acheter_plan", "plan": "mil_blindes" }), &regles).unwrap();
        assert!(m.pays[&a].a("mil_blindes") && m.pays[&a].res[CR] < 1.0);
        assert!(jeu::commande(&mut m, &ja, &json!({ "action": "acheter_plan", "plan": "mil_blindes" }), &regles).is_err());
        m.pays.get_mut(&a).unwrap().bloc = None;
        m.pays.get_mut(&b).unwrap().bloc = None;
        jeu::commande(&mut m, &ja, &json!({ "action": "proposer", "pays": b, "genre": "alliance" }), &regles).unwrap();
        jeu::commande(&mut m, &jb, &json!({ "action": "repondre", "pays": a, "genre": "alliance", "accepte": true }), &regles).unwrap();
        assert!(m.meme_bloc(a, b), "alliance fondee");
        assert_eq!(m.pays[&a].res[NO], 0.0, "plus de nourriture");
    }

    /// Minerai -> raffinerie -> elements -> fabrique -> produit.
    #[test]
    fn chaine_de_fabrication() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(84, 52, 20260925);
        assurer(&mut m, 1, &regles, 0.0);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let j = joueur(BASE_ID);
        let r = jeu::commande(&mut m, &j, &json!({ "action": "raffiner", "objet": "Fe", "qte": 2 }), &regles);
        assert!(r.is_err(), "pas de raffinerie : refuse");
        let cases: Vec<usize> = m.voisins(m.pays[&a].capitale).into_iter().filter(|&v| m.cases[v].proprio == Some(a)).collect();
        m.cases[cases[0]].bat = Some("raffinerie".into());
        m.cases[cases[0]].niv = 3;
        m.cases[cases[1]].bat = Some("usine".into());
        m.cases[cases[1]].niv = 1;
        m.pays.get_mut(&a).unwrap().res[ME] = 100.0;
        jeu::commande(&mut m, &j, &json!({ "action": "raffiner", "objet": "Fe", "qte": 4 }), &regles).unwrap();
        jeu::commande(&mut m, &j, &json!({ "action": "raffiner", "objet": "C", "qte": 2 }), &regles).unwrap();
        let r = jeu::commande(&mut m, &j, &json!({ "action": "fabriquer", "objet": "processeur" }), &regles);
        assert!(r.is_err(), "processeur : fabrique de niveau 3 requise");
        for _ in 0..120 { jeu::tick(&mut m, 1.0); }
        assert!(crate::fabrication::qte(&m.pays[&a].stock, "Fe") >= 4.0);
        jeu::commande(&mut m, &j, &json!({ "action": "fabriquer", "objet": "acier", "qte": 2 }), &regles).unwrap();
        for _ in 0..60 { jeu::tick(&mut m, 1.0); }
        assert_eq!(crate::fabrication::qte(&m.pays[&a].stock, "acier"), 4.0, "2 commandes x 2 acier");
        let credits = m.pays[&a].res[CR];
        jeu::commande(&mut m, &j, &json!({ "action": "vendre_objet", "objet": "acier", "qte": 1 }), &regles).unwrap();
        assert!(m.pays[&a].res[CR] > credits);
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
        let tir = json!({ "action": "missile", "armee": aid, "genre": "missile_nucleaire", "cible": cible, "matiere": 40 });
        let r = jeu::commande(&mut m, &j, &tir, &regles);
        assert!(r.is_err(), "sans matiere fissile ni explosifs : refuse");
        {
            let p = m.pays.get_mut(&a).unwrap();
            p.ur_enrichi = 100.0;
            p.stock.insert("explosifs".into(), 50.0);
        }
        let pop_b = m.pays[&b].pop;
        let r = jeu::commande(&mut m, &j, &tir, &regles);
        assert!(r.is_ok(), "tir : {:?}", r);
        assert!((m.pays[&a].ur_enrichi - 60.0).abs() < 1e-6, "40 kg d'uranium consommes");
        assert_eq!(crate::fabrication::qte(&m.pays[&a].stock, "explosifs"), 50.0 - jeu::explosifs_requis(40.0));
        for _ in 0..600 { jeu::tick(&mut m, 1.0); }
        assert!(m.missiles.is_empty(), "missile toujours en vol");
        assert!(m.cases[cible].irradiee > m.temps, "cible non irradiee");
        assert!(m.pays[&b].pop < pop_b * 0.95, "la population touchee baisse");
        // 40 kg : rayon 2 (1 + racine(2)), donc une case a distance 2 est touchee.
        let anneau = m.rayon(cible, 2).into_iter().find(|&v| m.distance(cible, v) == 2).unwrap();
        assert!(m.cases[anneau].irradiee > m.temps);
        assert_eq!(m.cases[cible].proprio, None, "le coeur de l'explosion devient neutre");
    }

    /// Une bombe H assez puissante peut couvrir toute la carte.
    #[test]
    fn bombe_h_sans_limite() {
        assert!(jeu::puissance_nucleaire("ogive_h", 1.0, 0.0) > jeu::puissance_nucleaire("plutonium", 500.0, 0.0));
        // 5 kg de plutonium : 20 cases de rayon.
        assert_eq!(jeu::rayon_nucleaire(jeu::puissance_nucleaire("plutonium", 5.0, 0.0)), 20);
        // Une bombe H couvre une carte 128 x 80.
        assert!(jeu::rayon_nucleaire(jeu::puissance_nucleaire("ogive_h", 1.0, 0.0)) >= 128);
    }
}
