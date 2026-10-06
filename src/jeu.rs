// ══════════════════════════════════════════════════════════════════
// jeu.rs — Regles du jeu
//   bilans()   : revenus, electricite, capacites de chaque pays
//   tick()     : avance la simulation de dt secondes de jeu
//   commande() : applique une action d'un joueur (validee ici, jamais
//                cote client)
// ══════════════════════════════════════════════════════════════════

use crate::defs::*;
use crate::fabrication::{self as fab, Fabrication};
use crate::front;
use crate::monde::*;
use rand::seq::SliceRandom;
use rand::Rng;
use serde::Serialize;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};

/// Intensite des combats : degats par seconde = attaque * K.
const K_COMBAT: f64 = 0.12;
/// Degats de bombardement pour perdre un niveau de batiment.
const DEGATS_NIVEAU: f64 = 300.0;
const DUREE_PROPOSITION: i64 = 3600;
const DUREE_PNA: i64 = 2 * 3600;
const TAILLE_MAX_BLOC: usize = 10;

pub struct Regles {
    pub protection_s: i64,
    /// Vitesse du jeu : les durees annoncees aux joueurs sont en temps reel.
    pub vitesse: f64,
}

fn maintenant() -> i64 {
    chrono::Utc::now().timestamp()
}

// ══════════════════════════════════════════════════════════════════
// Bilans
// ══════════════════════════════════════════════════════════════════
#[derive(Default, Clone, Serialize)]
pub struct Bilan {
    pub cases: u32,
    pub niv: BTreeMap<String, u32>,
    pub prod: Res,
    pub conso: Res,
    pub elec_prod: f64,
    pub elec_cons: f64,
    pub elec_ratio: f64,
    pub recherche: f64,
    pub influence: f64,
    pub pop_cap: f64,
    pub stock: f64,
    pub capacite: u32,
    pub vitesse: f64,
    pub slots: usize,
    pub croissance: f64,
    pub puissance: f64,
    pub unites: BTreeMap<String, u32>,
    /// Reserve de troupes maximale (front.rs).
    pub troupes_max: f64,
    /// Niveau de la meilleure fabrique (complexite des recettes).
    pub fab_max: u8,
    /// Niveaux de carrieres par gisement : rien / rare / radioactif / meteorite.
    pub carrieres: [f64; 4],
}

impl Bilan {
    pub fn n(&self, b: &str) -> f64 {
        *self.niv.get(b).unwrap_or(&0) as f64
    }
}

pub fn bilans(m: &Monde) -> HashMap<u32, Bilan> {
    let mut out: HashMap<u32, Bilan> = m.pays.keys().map(|&k| (k, Bilan::default())).collect();
    let mut fermes: HashMap<u32, f64> = HashMap::new();

    for c in &m.cases {
        let Some(p) = c.proprio else { continue };
        let Some(b) = out.get_mut(&p) else { continue };
        b.cases += 1;
        if c.irradiee > m.temps {
            continue;
        }
        if let Some(bat) = &c.bat {
            *b.niv.entry(bat.clone()).or_insert(0) += c.niv as u32;
            // La table de fabrication est dans le complexe industriel (et
            // dans les anciennes fabriques).
            if bat == "usine" || bat == "fabrique" {
                b.fab_max = b.fab_max.max(c.niv);
            }
            if bat == "ferme" {
                let f = if c.depot == D_FERTILE { 1.5 } else { 1.0 };
                *fermes.entry(p).or_insert(0.0) += c.niv as f64 * f;
            }
            // Une carriere sur un gisement extrait le minerai de ce gisement.
            if bat == "carriere" {
                let k = match c.depot { D_TERRES_RARES => 1, D_URANIUM => 2, D_METEORITE => 3, _ => 0 };
                b.carrieres[k] += c.niv as f64;
            }
        }
    }
    for a in m.armees.values() {
        if let Some(b) = out.get_mut(&a.proprio) {
            for (t, n) in &a.unites {
                *b.unites.entry(t.clone()).or_insert(0) += *n;
            }
        }
    }
    for mi in m.missions.values() {
        if let Some(b) = out.get_mut(&mi.proprio) {
            for (t, n) in &mi.unites {
                *b.unites.entry(t.clone()).or_insert(0) += *n;
            }
        }
    }

    for (pid, b) in out.iter_mut() {
        let p = &m.pays[pid];

        // ── Electricite ──
        let (mut ep, mut ec) = (0.0, 0.0);
        let thermique_ok = p.res[ME] > 1.0;
        let nucleaire_ok = p.ur_enrichi > 0.5;
        for (id, n) in &b.niv {
            let Some(d) = bat(id) else { continue };
            let n = *n as f64;
            if d.elec > 0.0 {
                let actif = match id.as_str() {
                    "centrale_thermique" => thermique_ok,
                    "centrale_nucleaire" => nucleaire_ok,
                    _ => true,
                };
                if actif {
                    ep += d.elec * n;
                }
            } else {
                ec += -d.elec * n;
            }
        }
        if p.spe == "energetique" { ep *= 1.30; }
        ep += fab::effet(&p.stock, "electricite");
        let ratio = if ec > 0.0 { (ep / ec).min(1.0) } else { 1.0 };
        b.elec_prod = ep;
        b.elec_cons = ec;
        b.elec_ratio = ratio;

        let spe = p.spe.as_str();

        // ── Population ──
        let urbanisme = 1.0 + 0.06 * p.niv("urbanisme");
        b.pop_cap = (200.0 * b.n("capitale") + 140.0 * b.n("ville") * urbanisme + 30.0 * b.n("hopital")) * (1.0 + 0.05 * p.niv("agronomie"));
        b.croissance = 1.0
            + 0.15 * b.n("hopital") * ratio
            + if p.a("eco_etat_providence") { 0.2 } else { 0.0 }
            + if spe == "agricole" { 0.4 } else { 0.0 }
            + fab::effet(&p.stock, "croissance");

        // ── Production (par minute) ──
        // Le territoire rapporte aussi : 0,15 credit par minute et par case.
        let mut cr = 40.0 * b.n("capitale") + 6.0 * b.n("ville") * ratio + 3.0 * b.n("usine") * ratio + p.pop * 0.18 + 0.15 * b.cases as f64;
        let mut mult_cr = 1.0 + 0.08 * b.n("banque") * ratio;
        mult_cr += 0.05 * p.niv("fiscalite");
        if p.a("eco_etat_providence") { mult_cr += 0.10; }
        if spe == "commerciale" { mult_cr += 0.15; }
        mult_cr += fab::effet(&p.stock, "credits");
        cr *= mult_cr;

        // Plus de nourriture dans le jeu.
        let no = 0.0;
        let _ = fermes.get(pid);

        let extraction = if p.a("ind_extraction") { 1.25 } else { 1.0 };
        let car = b.carrieres;
        // Production par minute et par niveau (relevee le 2026-10-05).
        let me = (15.0 * b.n("capitale") + (25.0 * b.n("mine") + 10.0 * car[0] + 8.0 * b.n("puits_petrole")) * ratio) * extraction;
        let le = (2.0 * b.n("foreuse") + 1.0 * car[3]) * ratio;
        let ur = (8.0 * b.n("mine_uranium") + 4.0 * car[2]) * ratio;
        let tr = (8.0 * b.n("extracteur_tr") + 4.0 * car[1]) * ratio;
        let mine = if spe == "miniere" { 1.20 } else { 1.0 };
        b.prod = [cr, no, me * mine, le * mine, ur * mine, tr * mine];

        // ── Consommation ──
        let mut conso = [0.0; NB_RES];
        if thermique_ok { conso[ME] += 3.0 * b.n("centrale_thermique") * if spe == "energetique" { 0.75 } else { 1.0 }; }
        let logistique = 1.0 - 0.04 * p.niv("logistique");
        for (t, n) in &b.unites {
            if let Some(u) = unite(t) {
                let n = *n as f64;
                conso[CR] += u.entretien[0] * n * logistique;
                conso[CR] += u.entretien[2] * 6.0 * n * logistique;
                b.puissance += u.puissance * n;
            }
        }
        b.conso = conso;

        // ── Recherche / influence ──
        let mut rech = 12.0 * b.n("capitale") + 15.0 * b.n("laboratoire") * ratio + p.pop * 0.02;
        if p.a("ind_electronique") { rech *= 1.10; }
        if spe == "scientifique" { rech *= 1.20; }
        rech *= 1.0 + 0.08 * p.niv("sciences");
        b.recherche = rech;

        let mut infl = 0.3 + 0.5 * b.n("centre_admin") + 1.5 * b.n("ambassade") * ratio;
        if p.a("dip_traites") { infl += 1.0; }
        if p.a("dip_onu") { infl += 5.0; }
        let mut mult_i = 1.0;
        mult_i += 0.06 * p.niv("rayonnement");
        if spe == "diplomatique" { mult_i += 0.30; }
        b.influence = infl * mult_i;

        // ── Capacites ──
        b.stock = (3000.0 + 4000.0 * b.n("entrepot")) * (1.0 + 0.12 * p.niv("stockage"));
        let mut cap = 10.0 + 6.0 * b.n("centre_admin") + 2.0 * b.n("ville");
        cap += 2.0 * p.niv("administration");
        if p.a("dip_onu") { cap += 10.0; }
        if spe == "diplomatique" { cap += 4.0; }
        if spe == "batisseuse" { cap += 3.0; }
        b.capacite = cap as u32;

        let mut v = 1.0 + 0.12 * b.n("usine") * ratio;
        v += 0.06 * p.niv("productivite");
        if spe == "industrielle" { v += 0.15; }
        v += fab::effet(&p.stock, "construction");
        b.vitesse = v;
        b.slots = (2 + (b.n("usine") as usize) / 3).min(5);
        b.troupes_max = front::maximum(p, b);
    }
    out
}

// ══════════════════════════════════════════════════════════════════
// Couts
// ══════════════════════════════════════════════════════════════════
pub fn niveau_max(p: &Pays) -> u8 {
    if p.a("ind_grands_travaux") { 8 } else { 5 }
}

pub fn cout_batiment(p: &Pays, d: &BatDef, niv: u8) -> Res {
    let f = 1.7f64.powi(niv as i32 - 1);
    let mut c = d.cout.map(|v| (v * f).round());
    c[ME] = (c[ME] * (1.0 - 0.03 * p.niv("siderurgie"))).round();
    if p.spe == "industrielle" { c[ME] = (c[ME] * 0.9).round(); }
    if p.spe == "forteresse" && d.id == "fort" { c = c.map(|v| (v * 0.7).round()); }
    c
}

pub fn temps_batiment(d: &BatDef, niv: u8) -> f64 {
    d.temps * 1.45f64.powi(niv as i32 - 1)
}

pub fn cout_unite(p: &Pays, u: &UniteDef, qte: u32) -> Res {
    let mut c = u.cout.map(|v| v * qte as f64);
    c[ME] *= 1.0 - 0.03 * p.niv("siderurgie");
    if p.spe == "militaire" { c = c.map(|v| v * 0.85); }
    c.map(|v| v.round())
}

/// Cout (points) de la prochaine recherche `id` : une technologie, ou
/// « am:<id> » pour le niveau suivant d'une amelioration. None si deja
/// acquise, au niveau maximal ou inconnue.
pub fn cout_recherche(p: &Pays, id: &str) -> Option<f64> {
    match id.strip_prefix("am:") {
        Some(a) => {
            let d = amelioration(a)?;
            let n = p.niv(a);
            (n < d.max as f64).then(|| (d.cout * 1.5f64.powf(n)).round())
        }
        None => {
            let d = tech(id)?;
            (!p.a(id)).then_some(d.cout)
        }
    }
}

pub fn nom_recherche(id: &str) -> Option<String> {
    match id.strip_prefix("am:") {
        Some(a) => amelioration(a).map(|d| d.nom.to_string()),
        None => tech(id).map(|d| d.nom.to_string()),
    }
}

/// Prix (credits) d'un point de recherche et d'un point d'influence au marche.
pub const PRIX_POINT_RECHERCHE: f64 = 12.0;
pub const PRIX_INFLUENCE: f64 = 30.0;

/// Prix d'une unite achetee toute faite au marche : son cout converti en
/// credits aux prix du jour, x1,5 (x2,5 sans la technologie).
pub fn prix_unite_marche(p: &Pays, u: &UniteDef, prix: &Res) -> f64 {
    let c = cout_unite(p, u, 1);
    let valeur: f64 = (0..NB_RES).map(|i| if i == CR { c[i] } else { c[i] * prix[i] }).sum();
    let marge = if u.tech.is_empty() || p.a(u.tech) { 1.5 } else { 2.5 };
    (valeur * marge).ceil()
}

/// Puissance d'une charge nucleaire, en « kg d'uranium enrichi » :
/// plutonium x1,5 (+30 % au plus avec le double d'explosifs), ogive
/// nucleaire 90 par ogive, bombe H 2 000 par bombe.
pub fn puissance_nucleaire(fissile: &str, quantite: f64, explosifs: f64) -> f64 {
    match fissile {
        "ogive" => quantite * 90.0,
        "ogive_h" => quantite * 2000.0,
        _ => {
            let mini = explosifs_requis(quantite);
            let bonus = if explosifs > 0.0 { ((explosifs / mini) - 1.0).clamp(0.0, 1.0) * 0.3 } else { 0.0 };
            quantite * if fissile == "plutonium" { 1.5 } else { 1.0 } * (1.0 + bonus)
        }
    }
}

/// Rayon (cases) d'une frappe : 5 kg de plutonium = 20 cases ; le rayon
/// grandit comme la racine carree de la puissance.
pub fn rayon_nucleaire(rend: f64) -> i64 {
    let facteur = 19.0 / (5.0f64 * 1.5).sqrt();
    (1.0 + facteur * rend.max(0.0).sqrt()).floor() as i64
}

fn charge_texte(fissile: &str, q: f64) -> String {
    match fissile {
        "ogive" => format!("{} ogive(s) nucléaire(s)", q),
        "ogive_h" => format!("{} bombe(s) H", q),
        "plutonium" => format!("{} kg de plutonium", q.round()),
        _ => format!("{} kg d'uranium", q.round()),
    }
}

/// Explosifs minimum pour faire detoner `kg` de matiere fissile.
pub fn explosifs_requis(kg: f64) -> f64 {
    (5.0 + kg / 4.0).ceil()
}

/// Risque d'accident a la mise en service d'une centrale nucleaire sans
/// la technologie « Nucleaire civil ».
pub const RISQUE_ACCIDENT: f64 = 0.25;

/// Accident nucleaire : la centrale est detruite, la zone irradiee, la
/// population touchee, et un nuage radioactif part avec le vent.
fn accident_nucleaire(m: &mut Monde, pid: u32, i: usize, rng: &mut impl Rng) {
    m.cases[i].bat = None;
    m.cases[i].niv = 0;
    for v in m.rayon(i, 1) {
        m.cases[v].irradiee = m.temps + 900.0;
        m.toucher(v);
    }
    if let Some(p) = m.pays.get_mut(&pid) {
        p.pop *= 0.85;
    }
    let id = m.nouvel_id();
    m.nuages.push(Nuage { id, case: i, dir: rng.gen_range(0..6), reste: 360.0, pas: 15.0 });
    m.effets.push(Effet { genre: "nucleaire".into(), case: i, rayon: 0 });
    let nom = m.nom_pays(pid);
    m.evenement(None, "nucleaire", format!("Accident nucléaire en {} : une centrale a explosé, un nuage radioactif dérive.", nom), Some(i));
}

/// Les nuages avancent avec le vent (qui tourne un peu) et irradient
/// les cases qu'ils survolent.
fn nuages(m: &mut Monde, dt: f64, rng: &mut impl Rng) {
    let mut garder = Vec::new();
    for mut n in std::mem::take(&mut m.nuages) {
        n.reste -= dt;
        n.pas -= dt;
        if n.pas <= 0.0 {
            n.pas += 15.0;
            if rng.gen_bool(0.3) {
                n.dir = (n.dir + if rng.gen_bool(0.5) { 1 } else { 5 }) % 6;
            }
            let voisins = m.voisins(n.case);
            match voisins.get(n.dir % voisins.len().max(1)) {
                Some(&v) => n.case = v,
                None => n.reste = 0.0,
            }
            m.cases[n.case].irradiee = m.cases[n.case].irradiee.max(m.temps + 240.0);
            m.toucher(n.case);
        }
        if n.reste > 0.0 {
            garder.push(n);
        }
    }
    m.nuages = garder;
}

/// Anciennes sauvegardes : les technologies-bonus supprimees deviennent
/// des niveaux d'amelioration equivalents ; les ids inconnus sont retires.
pub fn migrer(m: &mut Monde) {
    const CORRESPONDANCES: &[(&str, &str, u8)] = &[
        ("mil_doctrine", "armement", 2), ("eco_fiscalite", "fiscalite", 2), ("eco_bourse", "fiscalite", 3),
        ("eco_agriculture", "agronomie", 3), ("eco_urbanisme", "urbanisme", 4), ("eco_logistique", "logistique", 5),
        ("dip_administration", "administration", 2), ("dip_propagande", "rayonnement", 2), ("dip_soft_power", "rayonnement", 3),
        ("ind_mecanique", "productivite", 2), ("ind_automatisation", "productivite", 4), ("ind_acier", "siderurgie", 5),
        ("ind_stockage", "stockage", 4), ("ind_robotique", "robotique", 5),
    ];
    for p in m.pays.values_mut() {
        for &(ancienne, am, niv) in CORRESPONDANCES {
            if p.a(ancienne) {
                let max = amelioration(am).map(|d| d.max).unwrap_or(10);
                let n = p.amelio.entry(am.to_string()).or_insert(0);
                *n = (*n + niv).min(max);
            }
        }
        p.techs.retain(|t| tech(t).is_some());
        let valide = |x: &String| cout_recherche_valide(x);
        p.file_recherche.retain(valide);
        if p.recherche.as_ref().map(|r| !cout_recherche_valide(r)).unwrap_or(false) {
            p.recherche_stock += p.recherche_prog;
            p.recherche_prog = 0.0;
            p.recherche = None;
        }
    }
    // Annexions des anciennes parties (systeme des commandants, retire).
    for p in m.pays.values_mut() {
        p.chantiers.retain(|c| c.bat != "annexion");
    }
    // Version 2 : plus de petrole, les minerais deviennent les ressources de
    // base. L'ancien petrole compte comme minerai commun, les minerais du
    // stock passent dans les ressources, les gisements de petrole deviennent
    // des filons de minerai commun.
    if m.version < 2 {
        m.prix[LE] = 0.0;
        for p in m.pays.values_mut() {
            p.res[ME] += p.res[LE];
            p.res[LE] = 0.0;
            for (id, i) in [("minerai_commun", ME), ("minerai_legendaire", LE), ("minerai_radioactif", UR), ("minerai_rare", TR)] {
                p.res[i] += p.stock.remove(id).unwrap_or(0.0);
            }
            p.fabrications.retain(|f| !f.objet.starts_with("res:"));
        }
        for c in m.cases.iter_mut() {
            if c.depot == D_PETROLE {
                c.depot = D_METAL;
            }
        }
        m.version = 2;
    }
    // Version 3 : plus de nourriture.
    if m.version < 3 {
        m.prix[NO] = 0.0;
        for p in m.pays.values_mut() {
            p.res[NO] = 0.0;
        }
        m.version = 3;
    }
    // Version 4 : duree des lots en qte^0,75 (avant : proportionnelle).
    if m.version < 4 {
        for p in m.pays.values_mut() {
            for f in p.fabrications.iter_mut() {
                let q = f.qte.max(1) as f64;
                let nouveau = f.total / q * q.powf(0.75);
                let fait = if f.total > 0.0 { 1.0 - f.reste / f.total } else { 0.0 };
                f.total = nouveau;
                f.reste = nouveau * (1.0 - fait);
            }
        }
        m.version = 4;
    }
}

fn cout_recherche_valide(id: &String) -> bool {
    match id.strip_prefix("am:") {
        Some(a) => amelioration(a).is_some(),
        None => tech(id).is_some(),
    }
}

/// Volatilite des prix (ecart type relatif par racine de seconde) et
/// probabilite par seconde d'un choc sur une ressource donnee.
const VOLATILITE: f64 = 0.012;
const CHOC_PAR_S: f64 = 0.004;

fn marche(m: &mut Monde, dt: f64, rng: &mut impl Rng) {
    for c in m.cours.values_mut() {
        *c += (1.0 - *c) * (0.003 * dt).min(1.0);
    }
    m.cours.retain(|_, c| (*c - 1.0).abs() > 0.005);
    for i in 1..NB_RES {
        let base = RESSOURCES[i].prix_base;
        // Bruit gaussien (Box-Muller)
        let (u1, u2): (f64, f64) = (rng.gen_range(1e-9..1.0), rng.gen());
        let z = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
        m.prix[i] *= (z * VOLATILITE * dt.sqrt()).exp();
        m.prix[i] += (base - m.prix[i]) * (0.004 * dt).min(1.0);
        if rng.gen_bool((CHOC_PAR_S * dt).min(1.0)) {
            let hausse = rng.gen_bool(0.5);
            let ampleur = rng.gen_range(0.15..0.45);
            m.prix[i] *= if hausse { 1.0 + ampleur } else { 1.0 - ampleur * 0.7 };
            let nom = RESSOURCES[i].nom.to_lowercase();
            let pct = (ampleur * if hausse { 100.0 } else { 70.0 }).round();
            let texte = if hausse {
                format!("Marché : pénurie de {}, le prix bondit de {} %.", nom, pct)
            } else {
                format!("Marché : surproduction de {}, le prix chute de {} %.", nom, pct)
            };
            m.evenement(None, "monde", texte, None);
        }
        m.prix[i] = m.prix[i].clamp(base * 0.25, base * 4.0);
    }
}

/// Terres neutres encerclees par UNE nation (la mer et le bord du monde
/// ferment aussi la poche) : elles lui reviennent, sauf si des troupes
/// etrangeres s'y trouvent ou si une autre nation touche la poche.
/// Garde-fou : taille maximale (provinces) d'une poche prise par encerclement.
const POCHE_MAX: usize = 400;

fn encerclements(m: &mut Monde) {
    let n = m.cases.len();
    let mut vu = vec![false; n];
    for depart in 0..n {
        if vu[depart] || m.cases[depart].proprio.is_some() || !est_terre(m.cases[depart].terrain) {
            continue;
        }
        let mut poche = vec![depart];
        let mut pile = vec![depart];
        vu[depart] = true;
        let mut entoure_par: Option<u32> = None;
        let mut ouverte = false;
        let mut cote = false;
        let mut contact: HashSet<usize> = HashSet::new();
        while let Some(i) = pile.pop() {
            let voisins = m.voisins(i);
            if voisins.len() < 6 {
                cote = true; // bord du monde : ferme la poche comme la mer
            }
            for v in voisins {
                let c = &m.cases[v];
                if !est_terre(c.terrain) {
                    cote = true;
                } else if let Some(o) = c.proprio {
                    contact.insert(v);
                    match entoure_par {
                        None => entoure_par = Some(o),
                        Some(x) if x != o => ouverte = true,
                        _ => {}
                    }
                } else if !vu[v] {
                    vu[v] = true;
                    poche.push(v);
                    pile.push(v);
                }
            }
        }
        let Some(pid) = entoure_par else { continue };
        // Garde-fou, et contre la mer : une poche adossée à l'eau doit être
        // bien bordée par la nation (sinon un seul point sur la côte d'une
        // île donnerait toute l'île).
        if poche.len() > POCHE_MAX || (cote && contact.len() < (poche.len() / 4).max(2)) {
            continue;
        }
        if ouverte || m.pays.get(&pid).map(|p| p.elimine).unwrap_or(true) {
            continue;
        }
        let etrangers = m.armees.values().any(|a| a.proprio != pid && poche.contains(&a.case));
        if etrangers {
            continue;
        }
        for &i in &poche {
            m.cases[i].proprio = Some(pid);
            m.toucher(i);
            for p in m.pays.values_mut() {
                p.chantiers.retain(|c| !(c.case == i && c.bat == "annexion"));
            }
        }
        let texte = if poche.len() == 1 {
            "Territoire encerclé : une province rejoint votre nation.".to_string()
        } else {
            format!("Territoire encerclé : {} provinces rejoignent votre nation.", poche.len())
        };
        m.evenement(Some(pid), "construction", texte, Some(poche[0]));
    }
}

pub fn frais_marche(p: &Pays) -> f64 {
    if p.a("eco_mondialisation") {
        0.0
    } else if p.a("eco_commerce") || p.spe == "commerciale" {
        0.04
    } else {
        0.08
    }
}

fn peut_payer(p: &Pays, c: &Res) -> bool {
    (0..NB_RES).all(|i| p.res[i] + 1e-9 >= c[i])
}

fn payer(p: &mut Pays, c: &Res) {
    for i in 0..NB_RES {
        p.res[i] -= c[i];
    }
}

fn rembourser(p: &mut Pays, c: &Res, part: f64) {
    for i in 0..NB_RES {
        p.res[i] += c[i] * part;
    }
}

fn manque(c: &Res, p: &Pays) -> String {
    let v: Vec<String> = (0..NB_RES)
        .filter(|&i| p.res[i] + 1e-9 < c[i])
        .map(|i| format!("{} {}", (c[i] - p.res[i]).ceil(), RESSOURCES[i].nom.to_lowercase()))
        .collect();
    format!("Ressources insuffisantes : il manque {}.", v.join(", "))
}

fn mod_attaque(p: &Pays, u: &UniteDef) -> f64 {
    let mut m = 1.0;
    if u.domaine == DOM_TERRE { m += 0.05 * p.niv("armement"); }
    if p.spe == "militaire" { m += 0.10; }
    m
}

// ══════════════════════════════════════════════════════════════════
// Armees : helpers
// ══════════════════════════════════════════════════════════════════
pub fn domaine(a: &Armee) -> &'static str {
    a.unites.keys().next().and_then(|t| unite(t)).map(|u| u.domaine).unwrap_or(DOM_TERRE)
}

fn domaine_unites(u: &BTreeMap<String, u32>) -> &'static str {
    u.keys().next().and_then(|t| unite(t)).map(|u| u.domaine).unwrap_or(DOM_TERRE)
}

pub fn vitesse_armee(a: &Armee) -> f64 {
    a.unites
        .keys()
        .filter_map(|t| unite(t))
        .map(|u| u.vitesse)
        .fold(f64::MAX, f64::min)
        .min(50.0)
}

fn total_unites(u: &BTreeMap<String, u32>) -> u32 {
    u.values().sum()
}

fn hostile(m: &Monde, a: u32, b: u32) -> bool {
    m.en_guerre(a, b)
}

fn peut_traverser(m: &Monde, pid: u32, i: usize) -> bool {
    match m.cases[i].proprio {
        None => true,
        Some(o) => o == pid || m.meme_bloc(pid, o) || m.en_guerre(pid, o),
    }
}

fn a_port(m: &Monde, pid: u32) -> bool {
    m.cases.iter().any(|c| c.proprio == Some(pid) && c.bat.as_deref() == Some("port"))
}

#[derive(PartialEq)]
struct Noeud {
    f: f64,
    i: usize,
}
impl Eq for Noeud {}
impl PartialOrd for Noeud {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Noeud {
    fn cmp(&self, o: &Self) -> Ordering {
        o.f.partial_cmp(&self.f).unwrap_or(Ordering::Equal)
    }
}

/// Cout de traversee d'une case pour une armee (None = infranchissable).
fn cout_case(m: &Monde, pid: u32, dom: &str, amphibie: bool, i: usize) -> Option<f64> {
    let c = &m.cases[i];
    let terre = est_terre(c.terrain);
    match dom {
        DOM_TERRE => {
            if terre {
                if !peut_traverser(m, pid, i) {
                    return None;
                }
                let mut k = TERRAINS[c.terrain as usize].cout_mvt;
                if c.bat.as_deref() == Some("fort") && c.proprio.map(|o| o != pid).unwrap_or(false) {
                    k *= 1.0 + 0.2 * c.niv as f64;
                }
                Some(k)
            } else if amphibie {
                Some(2.0)
            } else {
                None
            }
        }
        DOM_MER => {
            if !terre {
                Some(1.0)
            } else if c.bat.as_deref() == Some("port")
                && c.proprio.map(|o| o == pid || m.meme_bloc(pid, o) || m.en_guerre(pid, o)).unwrap_or(false)
            {
                Some(1.0)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn chemin(m: &Monde, pid: u32, depart: usize, cible: usize, dom: &str) -> Option<Vec<usize>> {
    if depart == cible {
        return Some(vec![]);
    }
    let amphibie = dom == DOM_TERRE
        && m.pays.get(&pid).map(|p| p.a("mil_amphibie")).unwrap_or(false)
        && a_port(m, pid);
    cout_case(m, pid, dom, amphibie, cible)?;

    let mut ouvert = BinaryHeap::new();
    let mut g: HashMap<usize, f64> = HashMap::new();
    let mut venu: HashMap<usize, usize> = HashMap::new();
    g.insert(depart, 0.0);
    ouvert.push(Noeud { f: m.distance(depart, cible) as f64, i: depart });
    let mut explores = 0;
    while let Some(Noeud { i, .. }) = ouvert.pop() {
        if i == cible {
            let mut v = vec![i];
            let mut c = i;
            while let Some(&p) = venu.get(&c) {
                if p == depart {
                    break;
                }
                v.push(p);
                c = p;
            }
            v.reverse();
            return Some(v);
        }
        explores += 1;
        if explores > 25_000 {
            return None;
        }
        let gi = g[&i];
        for v in m.voisins(i) {
            let Some(k) = cout_case(m, pid, dom, amphibie, v) else { continue };
            let ng = gi + k;
            if ng < *g.get(&v).unwrap_or(&f64::MAX) {
                g.insert(v, ng);
                venu.insert(v, i);
                ouvert.push(Noeud { f: ng + m.distance(v, cible) as f64, i: v });
            }
        }
    }
    None
}

/// Ajoute des unites a la garnison du bon domaine sur la case (ou en cree une).
fn deposer_unites(m: &mut Monde, pid: u32, case: usize, unites: &BTreeMap<String, u32>) {
    let dom = domaine_unites(unites);
    let existante = m
        .armees
        .values()
        .find(|a| a.proprio == pid && a.case == case && a.chemin.is_empty() && a.assaut.is_none() && domaine(a) == dom)
        .map(|a| a.id);
    let id = match existante {
        Some(id) => id,
        None => {
            let id = m.nouvel_id();
            let nom = match dom {
                DOM_AIR => format!("Escadre {}", id),
                DOM_MER => format!("Flotte {}", id),
                DOM_MISSILE => format!("Arsenal {}", id),
                _ => format!("{}e division", id),
            };
            m.armees.insert(id, Armee {
                id, proprio: pid, case, unites: BTreeMap::new(), blessures: BTreeMap::new(),
                chemin: vec![], progres: 0.0, bombarde: None, assaut: None, nom,
            });
            id
        }
    };
    let a = m.armees.get_mut(&id).unwrap();
    for (t, n) in unites {
        *a.unites.entry(t.clone()).or_insert(0) += *n;
    }
}

/// Inflige des degats a un ensemble d'unites. Rend (unites tuees, puissance tuee).
fn blesser(unites: &mut BTreeMap<String, u32>, blessures: &mut BTreeMap<String, f64>, dmg: f64) -> (f64, f64) {
    let poids: f64 = unites.iter().map(|(t, n)| *n as f64 * unite(t).map(|u| u.pv).unwrap_or(100.0)).sum();
    if poids <= 0.0 || dmg <= 0.0 {
        return (0.0, 0.0);
    }
    let (mut tues, mut puiss) = (0.0, 0.0);
    for (t, n) in unites.iter_mut() {
        let Some(u) = unite(t) else { continue };
        let part = *n as f64 * u.pv / poids;
        let b = blessures.entry(t.clone()).or_insert(0.0);
        *b += dmg * part;
        let k = ((*b / u.pv).floor() as u32).min(*n);
        *n -= k;
        *b -= k as f64 * u.pv;
        if *n == 0 {
            *b = 0.0;
        }
        tues += k as f64;
        puiss += k as f64 * u.puissance;
    }
    unites.retain(|_, n| *n > 0);
    blessures.retain(|t, _| unites.contains_key(t));
    (tues, puiss)
}

/// Repartit des degats sur plusieurs armees au prorata de leurs PV.
fn blesser_armees(m: &mut Monde, ids: &[u32], dmg: f64) -> (f64, f64) {
    let poids: Vec<(u32, f64)> = ids
        .iter()
        .filter_map(|id| m.armees.get(id))
        .map(|a| (a.id, a.unites.iter().map(|(t, n)| *n as f64 * unite(t).map(|u| u.pv).unwrap_or(100.0)).sum::<f64>()))
        .collect();
    let total: f64 = poids.iter().map(|(_, w)| w).sum();
    if total <= 0.0 {
        return (0.0, 0.0);
    }
    let (mut tues, mut puiss) = (0.0, 0.0);
    for (id, w) in poids {
        if let Some(a) = m.armees.get_mut(&id) {
            let (t, p) = blesser(&mut a.unites, &mut a.blessures, dmg * w / total);
            tues += t;
            puiss += p;
        }
    }
    (tues, puiss)
}

fn composition(m: &Monde, ids: &[u32]) -> (f64, f64, f64, f64) {
    // (poids terre, poids mer, defense moyenne ponderee, poids total)
    let (mut t, mut s, mut d, mut w) = (0.0, 0.0, 0.0, 0.0);
    for id in ids {
        let Some(a) = m.armees.get(id) else { continue };
        for (ty, n) in &a.unites {
            let Some(u) = unite(ty) else { continue };
            let p = *n as f64 * u.pv;
            if u.domaine == DOM_MER { s += p } else { t += p }
            d += u.defense * p;
            w += p;
        }
    }
    (t, s, if w > 0.0 { d / w } else { 0.0 }, w)
}

fn puissance_feu(m: &Monde, ids: &[u32], cible_terre: f64, cible_mer: f64) -> f64 {
    let tot = cible_terre + cible_mer;
    if tot <= 0.0 {
        return 0.0;
    }
    let (ft, fm) = (cible_terre / tot, cible_mer / tot);
    let mut f = 0.0;
    for id in ids {
        let Some(a) = m.armees.get(id) else { continue };
        let Some(p) = m.pays.get(&a.proprio) else { continue };
        for (ty, n) in &a.unites {
            let Some(u) = unite(ty) else { continue };
            f += *n as f64 * (u.att_sol * ft + u.att_mer * fm) * mod_attaque(p, u);
        }
    }
    f
}

fn est_combattante(a: &Armee) -> bool {
    matches!(domaine(a), DOM_TERRE | DOM_MER) && !a.unites.is_empty()
}

// ══════════════════════════════════════════════════════════════════
// Territoire
// ══════════════════════════════════════════════════════════════════
fn relocaliser_capitale(m: &mut Monde, pid: u32) {
    let mut meilleure: Option<(usize, i64)> = None;
    for (i, c) in m.cases.iter().enumerate() {
        if c.proprio != Some(pid) {
            continue;
        }
        let score = match c.bat.as_deref() {
            Some("ville") => 100 + c.niv as i64,
            Some(_) => 10,
            None => 1,
        };
        if meilleure.map(|(_, s)| score > s).unwrap_or(true) {
            meilleure = Some((i, score));
        }
    }
    if let Some((i, _)) = meilleure {
        m.cases[i].bat = Some("capitale".into());
        m.cases[i].niv = 1;
        m.cases[i].degats = 0.0;
        m.toucher(i);
        if let Some(p) = m.pays.get_mut(&pid) {
            p.capitale = i;
        }
        m.evenement(Some(pid), "alerte", "Le gouvernement s'est replié dans une nouvelle capitale.".into(), Some(i));
    }
}

pub fn capturer(m: &mut Monde, pid: u32, i: usize) {
    let ancien = m.cases[i].proprio;
    if ancien == Some(pid) {
        return;
    }
    m.cases[i].proprio = Some(pid);
    let mut capitale_tombee = false;
    if let Some(b) = m.cases[i].bat.clone() {
        if b == "capitale" {
            capitale_tombee = true;
            m.cases[i].bat = Some("ville".into());
            m.cases[i].niv = m.cases[i].niv.max(1);
        } else if m.cases[i].niv > 1 {
            m.cases[i].niv -= 1;
        }
    }
    m.cases[i].degats = 0.0;
    m.toucher(i);

    // Garnisons non combattantes (avions au sol, missiles) perdues.
    if let Some(a) = ancien {
        let perdues: Vec<u32> = m
            .armees
            .values()
            .filter(|x| x.proprio == a && x.case == i && !est_combattante(x))
            .map(|x| x.id)
            .collect();
        for id in perdues {
            m.armees.remove(&id);
        }
        if let Some(p) = m.pays.get_mut(&a) {
            p.chantiers.retain(|c| c.case != i);
            p.productions.retain(|c| c.case != i);
        }
    }
    let nom_att = m.nom_pays(pid);
    if let Some(p) = m.pays.get_mut(&pid) {
        p.stats.cases_conquises += 1;
    }
    if let Some(a) = ancien {
        let nom_def = m.nom_pays(a);
        m.evenement(Some(a), "alerte", format!("{} s'est emparé d'une de vos provinces.", nom_att), Some(i));
        m.evenement(Some(pid), "victoire", format!("Province conquise sur {}.", nom_def), Some(i));
        if capitale_tombee {
            let butin = m.pays.get(&a).map(|p| (p.res[CR] * 0.25).floor()).unwrap_or(0.0);
            if let Some(p) = m.pays.get_mut(&a) {
                p.res[CR] -= butin;
            }
            if let Some(p) = m.pays.get_mut(&pid) {
                p.res[CR] += butin;
            }
            m.evenement(None, "guerre", format!("La capitale de {} est tombée aux mains de {} !", nom_def, nom_att), Some(i));
            relocaliser_capitale(m, a);
        }
    }
}

fn reduire_batiment(m: &mut Monde, i: usize, niveaux: u8) {
    let c = &mut m.cases[i];
    if let Some(b) = c.bat.clone() {
        if c.niv > niveaux {
            c.niv -= niveaux;
        } else if b == "capitale" {
            c.niv = 1;
        } else {
            c.bat = None;
            c.niv = 0;
        }
        m.toucher(i);
    }
}

fn endommager_batiment(m: &mut Monde, i: usize, dmg: f64) {
    if m.cases[i].bat.is_none() {
        return;
    }
    m.cases[i].degats += dmg;
    while m.cases[i].degats >= DEGATS_NIVEAU && m.cases[i].bat.is_some() {
        m.cases[i].degats -= DEGATS_NIVEAU;
        let avant = m.cases[i].niv;
        reduire_batiment(m, i, 1);
        if m.cases[i].bat.as_deref() == Some("capitale") && avant == 1 {
            m.cases[i].degats = 0.0;
            break;
        }
    }
}

fn apparition(m: &Monde) -> Option<usize> {
    let mut rng = rand::thread_rng();
    let capitales: Vec<usize> = m.pays.values().filter(|p| !p.elimine).map(|p| p.capitale).collect();
    for (dist_cap, dist_terr) in [(9, 3), (7, 2), (5, 1), (3, 1)] {
        let mut candidats = Vec::new();
        for i in 0..m.cases.len() {
            let c = &m.cases[i];
            if c.proprio.is_some() || !matches!(c.terrain, T_PLAINE | T_FORET | T_COLLINE | T_DESERT | T_TOUNDRA) {
                continue;
            }
            let vois = m.voisins(i);
            if vois.iter().filter(|&&v| est_terre(m.cases[v].terrain) && m.cases[v].proprio.is_none()).count() < 5 {
                continue;
            }
            if capitales.iter().any(|&k| m.distance(k, i) < dist_cap) {
                continue;
            }
            if m.rayon(i, dist_terr).iter().any(|&v| m.cases[v].proprio.is_some()) {
                continue;
            }
            candidats.push(i);
        }
        if let Some(&i) = candidats.choose(&mut rng) {
            return Some(i);
        }
    }
    None
}

/// Plus de terre libre : on prend une case d'une nation jouee par
/// l'ordinateur, la plus eloignee de toutes les capitales, avec ses voisines
/// tenues par des bots. Un joueur peut ainsi toujours rejoindre la partie.
fn apparition_chez_un_bot(m: &mut Monde) -> Option<usize> {
    let capitales: Vec<usize> = m.pays.values().filter(|p| !p.elimine).map(|p| p.capitale).collect();
    let est_bot = |m: &Monde, o: Option<u32>| o.and_then(|o| m.pays.get(&o)).map(|p| crate::bots::est_bot(p.user_id)).unwrap_or(false);
    let i = (0..m.cases.len())
        .filter(|&i| est_terre(m.cases[i].terrain) && est_bot(m, m.cases[i].proprio) && m.cases[i].bat.as_deref() != Some("capitale"))
        .max_by_key(|&i| capitales.iter().map(|&c| m.distance(c, i)).min().unwrap_or(0))?;
    for v in m.rayon(i, 1) {
        if est_terre(m.cases[v].terrain) && est_bot(m, m.cases[v].proprio) && m.cases[v].bat.as_deref() != Some("capitale") {
            m.cases[v].proprio = None;
            m.cases[v].bat = None;
            m.cases[v].niv = 0;
            m.toucher(v);
        }
    }
    let zone = m.rayon(i, 1);
    let bots: HashSet<u32> = m.pays.values().filter(|p| crate::bots::est_bot(p.user_id)).map(|p| p.id).collect();
    m.armees.retain(|_, a| !(zone.contains(&a.case) && bots.contains(&a.proprio)));
    Some(i)
}

fn installer_pays(m: &mut Monde, pid: u32, regles: &Regles) -> Result<(), String> {
    let cap = match apparition(m) {
        Some(c) => c,
        None => apparition_chez_un_bot(m).ok_or("Plus aucune terre libre pour fonder une nation.")?,
    };
    let maint = maintenant();
    m.cases[cap].proprio = Some(pid);
    m.cases[cap].bat = Some("capitale".into());
    m.cases[cap].niv = 1;
    m.toucher(cap);
    for v in m.voisins(cap) {
        if est_terre(m.cases[v].terrain) && m.cases[v].proprio.is_none() {
            m.cases[v].proprio = Some(pid);
            m.toucher(v);
        }
    }
    let p = m.pays.get_mut(&pid).unwrap();
    p.capitale = cap;
    p.res = [1500.0, 0.0, 650.0, 0.0, 0.0, 0.0];
    p.pop = 120.0;
    p.influence = 20.0;
    p.recherche_stock = if p.spe == "scientifique" { 160.0 } else { 80.0 };
    p.techs.clear();
    p.amelio.clear();
    p.ur_enrichi = 0.0;
    p.recherche = None;
    p.recherche_prog = 0.0;
    p.file_recherche.clear();
    p.chantiers.clear();
    p.productions.clear();
    p.protection = maint + regles.protection_s;
    p.elimine = false;
    p.troupes = front::TROUPES_DEPART;
    p.stock.clear();
    p.fabrications.clear();
    let mut garnison = BTreeMap::new();
    garnison.insert("infanterie".to_string(), 6);
    deposer_unites(m, pid, cap, &garnison);
    Ok(())
}

// ══════════════════════════════════════════════════════════════════
// Fabrication : minerais, raffinerie, fabrique
// ══════════════════════════════════════════════════════════════════
/// Commandes en attente au maximum par atelier.
pub const FILE_FABRICATION: usize = 40;
/// Lignes qui tournent en meme temps dans un atelier, au plus.
pub const LIGNES_MAX: usize = 12;

/// Niveaux cumules d'un atelier : la raffinerie, ou pour la fabrication le
/// complexe industriel (plus les anciennes fabriques).
pub fn niveau_atelier(b: &Bilan, atelier: &str) -> f64 {
    if atelier == "raffinerie" { b.n("raffinerie") } else { b.n("usine") + b.n("fabrique") }
}

/// Credits par point de recherche pour acheter un plan au marche.
pub const PRIX_PLAN: f64 = 5.0;

/// Prix d'un plan (technologie, ou « am:<id> » pour le niveau suivant d'une
/// amelioration). None si deja acquis ou inconnu.
pub fn prix_plan(p: &Pays, id: &str) -> Option<f64> {
    let k = if p.spe == "scientifique" { 0.8 } else { 1.0 };
    cout_recherche(p, id).map(|c| (c * PRIX_PLAN * k).round())
}

/// Les laboratoires inventent parfois tout seuls une technologie (environ
/// 5 % de chances par minute et par niveau, deux fois plus pour une elite
/// scientifique) : de preference les moins cheres.
fn inventions(m: &mut Monde, bl: &HashMap<u32, Bilan>, dt: f64, rng: &mut impl Rng) {
    let ids: Vec<u32> = m.pays.keys().copied().collect();
    for pid in ids {
        let p = &m.pays[&pid];
        let Some(b) = bl.get(&pid) else { continue };
        if p.elimine || b.n("laboratoire") <= 0.0 {
            continue;
        }
        let k = (if p.spe == "scientifique" { 2.0 } else { 1.0 }) * (1.0 + fab::effet(&p.stock, "invention"));
        let chance = (0.05 / 60.0 * b.n("laboratoire") * b.elec_ratio * k * dt).min(0.5);
        if !rng.gen_bool(chance) {
            continue;
        }
        let dispo: Vec<(&str, f64)> = TECHS.iter().filter(|t| !p.a(t.id)).map(|t| (t.id, 1.0 / t.cout.max(1.0))).collect();
        let total: f64 = dispo.iter().map(|(_, w)| w).sum();
        if total <= 0.0 {
            continue;
        }
        let mut x = rng.gen::<f64>() * total;
        let Some(&(id, _)) = dispo.iter().find(|(_, w)| { x -= w; x <= 0.0 }).or(dispo.last()) else { continue };
        let id = id.to_string();
        let nom = nom_recherche(&id).unwrap_or_default();
        m.pays.get_mut(&pid).unwrap().techs.push(id);
        m.evenement(Some(pid), "recherche", format!("Vos laboratoires ont mis au point : {} !", nom), None);
    }
}

/// Planifie tout ce qu'il faut pour obtenir `n` x `id` : ce qui manque est
/// raffine (elements) ou fabrique (produits), recursivement. `dispo` est le
/// stock virtuel (deja reserve retire). Rend les lignes, feuilles d'abord.
fn planifier(
    id: &str, n: f64, dispo: &mut HashMap<String, f64>, b: &Bilan,
    plan: &mut Vec<(&'static str, String, u32)>, minerai: &mut HashMap<&'static str, f64>, profondeur: u32,
) -> Result<(), String> {
    if profondeur > 30 {
        return Err("Recette trop profonde.".into());
    }
    let a = dispo.entry(id.to_string()).or_insert(0.0);
    let pris = a.min(n);
    *a -= pris;
    let reste = n - pris;
    if reste <= 1e-9 {
        return Ok(());
    }
    if let Some(e) = fab::element(id) {
        let lots = reste.ceil();
        *minerai.entry(fab::minerai_de(e.categorie)).or_insert(0.0) += lots * fab::minerai_par_element(e);
        plan.push(("raffinerie", id.to_string(), lots as u32));
        *dispo.get_mut(id).unwrap() += lots - reste;
        return Ok(());
    }
    let d = fab::produit(id).ok_or_else(|| format!("{} ne se fabrique pas.", fab::nom_objet(id)))?;
    if d.niveau > b.fab_max {
        return Err(format!("{} demande un complexe industriel de niveau {} (le vôtre : {}).", d.nom, d.niveau, b.fab_max));
    }
    let lots = (reste / d.sortie).ceil();
    if lots > 1000.0 {
        return Err("Quantité trop grande.".into());
    }
    for (i, q) in d.entrees {
        planifier(i, q * lots, dispo, b, plan, minerai, profondeur + 1)?;
    }
    plan.push(("fabrique", id.to_string(), lots as u32));
    *dispo.entry(id.to_string()).or_insert(0.0) += lots * d.sortie - reste;
    Ok(())
}

/// « Tout fabriquer » : lance d'un coup toute la chaine d'un produit. Chaque
/// etape demarre des que les etapes precedentes ont livre leurs matieres.
fn fabriquer_chaine(m: &mut Monde, pid: u32, b: &Bilan, cmd: &Value) -> Result<String, String> {
    let objet = s(cmd, "objet").to_string();
    let qte = u(cmd, "qte").unwrap_or(1).clamp(1, 1000) as f64;
    let d = fab::produit(&objet).ok_or("Recette inconnue.")?;
    let p = &m.pays[&pid];
    let mut dispo: HashMap<String, f64> = p.stock.clone().into_iter().collect();
    let mut plan = Vec::new();
    let mut minerai = HashMap::new();
    // On vise qte produits EN PLUS de ceux deja en stock.
    dispo.insert(objet.clone(), 0.0);
    planifier(&objet, qte * d.sortie, &mut dispo, b, &mut plan, &mut minerai, 0)?;
    let manque: Vec<String> = minerai
        .iter()
        .filter_map(|(mi, n)| {
            let i = fab::index_minerai(mi)?;
            (p.res[i] + 1e-9 < *n).then(|| format!("{} {}", (n - p.res[i]).ceil(), fab::nom_objet(mi).to_lowercase()))
        })
        .collect();
    if !manque.is_empty() {
        return Err(format!("Pas assez de minerai pour toute la chaîne : il manque {}.", manque.join(", ")));
    }
    if plan.iter().any(|(a, _, _)| *a == "raffinerie") && niveau_atelier(b, "raffinerie") <= 0.0 {
        return Err("La chaîne demande de raffiner des éléments : construisez une raffinerie.".into());
    }
    if niveau_atelier(b, "fabrique") <= 0.0 {
        return Err("Construisez d'abord un complexe industriel.".into());
    }
    let deja = p.fabrications.len();
    if deja + plan.len() > 2 * FILE_FABRICATION {
        return Err(format!("Trop d'étapes en attente ({} + {}).", deja, plan.len()));
    }
    let etapes = plan.len();
    for (atelier, id, lots) in plan {
        let unite = if atelier == "raffinerie" {
            fab::recette_raffinage(&id).map(|r| r.2).unwrap_or(2.0)
        } else {
            fab::produit(&id).map(|d| d.temps).unwrap_or(10.0)
        };
        let fid = m.nouvel_id();
        let t = duree_lot(unite, lots);
        m.pays.get_mut(&pid).unwrap().fabrications.push(Fabrication {
            id: fid, atelier: atelier.into(), objet: id, qte: lots, reste: t, total: t, auto: false, cible: 0.0, paye: false,
        });
    }
    Ok(format!("Chaîne lancée : {} × {} en {} étapes.", qte * d.sortie, d.nom, etapes))
}

/// Matieres consommees par une commande (rendues si on l'annule).
fn entrees_fabrication(atelier: &str, objet: &str, qte: u32) -> Vec<(String, f64)> {
    let q = qte as f64;
    if atelier == "raffinerie" {
        fab::recette_raffinage(objet).map(|(m, n, _)| vec![(m.to_string(), n * q)]).unwrap_or_default()
    } else {
        fab::produit(objet).map(|p| p.entrees.iter().map(|(i, n)| (i.to_string(), n * q)).collect()).unwrap_or_default()
    }
}

fn commander_fabrication(m: &mut Monde, pid: u32, b: &Bilan, action: &str, cmd: &Value) -> Result<String, String> {
    let objet = s(cmd, "objet").to_string();
    let qte = u(cmd, "qte").unwrap_or(1).clamp(1, 1000) as u32;
    let auto = cmd.get("auto").and_then(|v| v.as_bool()).unwrap_or(false);
    let cible = cmd.get("cible").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 1e7);
    let (atelier, temps, nom) = if action == "raffiner" {
        let (_, _, t) = fab::recette_raffinage(&objet).ok_or("La raffinerie ne sait pas produire ça.")?;
        ("raffinerie", duree_lot(t, qte), fab::nom_objet(&objet))
    } else {
        let d = fab::produit(&objet).ok_or("Recette inconnue.")?;
        if b.fab_max < d.niveau {
            return Err(format!("{} demande un complexe industriel de niveau {} (le vôtre : {}).", d.nom, d.niveau, b.fab_max));
        }
        ("fabrique", duree_lot(d.temps, qte), d.nom.to_string())
    };
    if niveau_atelier(b, atelier) <= 0.0 {
        return Err(if atelier == "raffinerie" { "Construisez d'abord une raffinerie." } else { "Construisez d'abord un complexe industriel." }.into());
    }
    let p = m.pays.get(&pid).unwrap();
    if p.fabrications.iter().filter(|f| f.atelier == atelier).count() >= FILE_FABRICATION {
        return Err(format!("File pleine ({} commandes).", FILE_FABRICATION));
    }
    let entrees = entrees_fabrication(atelier, &objet, qte);
    let manquants: Vec<String> = entrees
        .iter()
        .filter(|(i, n)| fab::possede(p, i) + 1e-9 < *n)
        .map(|(i, n)| format!("{} {}", (n - fab::possede(p, i)).ceil(), fab::nom_objet(i)))
        .collect();
    // Il manque des matieres pour une fabrication simple : on lance toute la
    // chaine (raffinage des elements, etapes intermediaires) avec le minerai.
    if !manquants.is_empty() && !auto && atelier == "fabrique" {
        return fabriquer_chaine(m, pid, b, cmd);
    }
    // Une ligne automatique peut attendre ses matieres ; une commande simple non.
    if !manquants.is_empty() && !auto {
        return Err(format!("Il manque : {}.", manquants.join(", ")));
    }
    let id = m.nouvel_id();
    let p = m.pays.get_mut(&pid).unwrap();
    let paye = manquants.is_empty();
    if paye {
        for (i, n) in &entrees {
            fab::retirer(p, i, *n);
        }
    }
    p.fabrications.push(Fabrication { id, atelier: atelier.into(), objet, qte, reste: temps, total: temps, auto, cible, paye });
    Ok(if auto {
        format!("Ligne automatique : {} × {} en continu{}.", qte, nom, if cible > 0.0 { format!(" (jusqu'à {} en stock)", cible) } else { String::new() })
    } else {
        format!("{} × {} commandés.", qte, nom)
    })
}

/// Une seconde de vie economique « materielle » d'un pays : extraction des
/// minerais, desintegration des legendaires, avancee des deux ateliers.
/// Rend les messages a afficher dans le journal.
/// Duree d'un lot de `qte` (secondes a la vitesse d'un niveau d'atelier) :
/// les grandes series vont plus vite a l'unite (qte^0,75 au lieu de qte).
pub fn duree_lot(unite: f64, qte: u32) -> f64 {
    unite * (qte.max(1) as f64).powf(0.75)
}

/// Lignes qui tournent en parallele dans un atelier : une par niveau.
pub fn lignes_atelier(b: &Bilan, atelier: &str) -> usize {
    (niveau_atelier(b, atelier).floor() as usize).min(LIGNES_MAX)
}

/// Production des ateliers : chaque ligne active avance a la vitesse d'un
/// niveau d'atelier ; une ligne automatique terminee repart d'elle-meme des
/// que ses matieres sont la. Rend les messages a afficher dans le journal.
fn fabriquer(p: &mut Pays, b: &Bilan, dt: f64) -> Vec<String> {
    let r = b.elec_ratio;
    fab::desintegrer(&mut p.stock, dt);
    let vitesse = r * (1.0 + 0.07 * p.niv("robotique"));
    let mut msgs = Vec::new();
    for atelier in ["raffinerie", "fabrique"] {
        let lignes = lignes_atelier(b, atelier);
        // Toute la puissance de l'atelier (un niveau = une unite de vitesse)
        // est partagee entre les lignes actives : une commande seule profite
        // de tous les niveaux.
        let mut choisies = Vec::new();
        for k in 0..p.fabrications.len() {
            if p.fabrications[k].atelier != atelier || choisies.len() >= lignes {
                continue;
            }
            // Ligne automatique en attente : preleve les matieres du lot suivant.
            if !p.fabrications[k].paye {
                let f = &p.fabrications[k];
                let plein = f.cible > 0.0 && fab::possede(p, &f.objet) >= f.cible;
                let entrees = entrees_fabrication(&f.atelier, &f.objet, f.qte);
                if plein || !entrees.iter().all(|(i, n)| fab::possede(p, i) + 1e-9 >= *n) {
                    continue;
                }
                for (i, n) in &entrees {
                    fab::retirer(p, i, *n);
                }
                p.fabrications[k].paye = true;
            }
            choisies.push(k);
        }
        if !choisies.is_empty() {
            let part = vitesse * niveau_atelier(b, atelier) / choisies.len() as f64;
            for &k in &choisies {
                p.fabrications[k].reste -= dt * part;
            }
        }
        let mut k = 0;
        while k < p.fabrications.len() {
            let f = &p.fabrications[k];
            if f.atelier != atelier || !f.paye || f.reste > 0.0 {
                k += 1;
                continue;
            }
            let (objet, q, auto) = (f.objet.clone(), f.qte as f64, f.auto);
            let sortie = if atelier == "raffinerie" { q } else { fab::produit(&objet).map(|d| d.sortie).unwrap_or(1.0) * q };
            fab::ajouter(&mut p.stock, &objet, sortie);
            if auto {
                let f = &mut p.fabrications[k];
                f.reste = f.total;
                f.paye = false;
                k += 1;
            } else {
                p.fabrications.remove(k);
                let quoi = if atelier == "raffinerie" { "Raffinage" } else { "Fabrication" };
                msgs.push(format!("{} terminé : {} × {}.", quoi, sortie, fab::nom_objet(&objet)));
            }
        }
    }
    msgs
}

/// Bombe a trou noir ou a antimatiere, tiree depuis un silo (portee
/// illimitee, impossible a intercepter).
fn arme_speciale(m: &mut Monde, pid: u32, cmd: &Value, regles: &Regles) -> Result<String, String> {
    let objet = s(cmd, "objet").to_string();
    if !matches!(objet.as_str(), "bombe_trou_noir" | "bombe_antimatiere") {
        return Err("Arme inconnue.".into());
    }
    let cible = u(cmd, "cible").ok_or("Cible manquante.")? as usize;
    if cible >= m.cases.len() {
        return Err("Cible invalide.".into());
    }
    if !m.cases[cible].proprio.map(|o| hostile(m, pid, o)).unwrap_or(false) {
        return Err("La cible doit appartenir à une nation en guerre avec vous.".into());
    }
    if fab::qte(&m.pays[&pid].stock, &objet) < 1.0 {
        return Err(format!("Aucune {} en stock : fabriquez-en une.", fab::nom_objet(&objet).to_lowercase()));
    }
    let depart = (0..m.cases.len())
        .filter(|&i| m.cases[i].proprio == Some(pid) && m.cases[i].bat.as_deref() == Some("silo"))
        .min_by_key(|&i| m.distance(i, cible))
        .ok_or("Il faut un silo à missiles pour tirer.")?;
    fab::ajouter(&mut m.pays.get_mut(&pid).unwrap().stock, &objet, -1.0);
    let duree = (m.distance(depart, cible) as f64 / 12.0 * 60.0).max(10.0);
    let mid = m.nouvel_id();
    m.missiles.insert(mid, MissileVol {
        id: mid, proprio: pid, genre: objet.clone(), depart, cible, progres: 0.0, duree,
        matiere: 0.0, explosifs: 0.0, fissile: String::new(),
    });
    let nom = m.nom_pays(pid);
    let quoi = fab::nom_objet(&objet);
    m.evenement(None, "nucleaire", format!("ALERTE MONDIALE : {} a lancé une {} !", nom, quoi.to_lowercase()), Some(cible));
    Ok(format!("{} lancée, impact dans {} s.", quoi, (duree / regles.vitesse).round()))
}

/// Pertes de population et de troupes d'une frappe : proportionnelles a la
/// densite de chaque pays touche et au nombre de ses cases dans la zone.
/// `zone` : (case, letalite 0..1). Rend les morts (milliers d'habitants).
fn pertes_frappe(m: &mut Monde, zone: &[(usize, f64)]) -> f64 {
    let mut touches: HashMap<u32, f64> = HashMap::new();
    for &(v, letal) in zone {
        if let Some(o) = m.cases[v].proprio {
            *touches.entry(o).or_insert(0.0) += letal;
        }
    }
    let mut morts = 0.0;
    for (o, poids) in touches {
        let cases = m.cases.iter().filter(|c| c.proprio == Some(o)).count().max(1) as f64;
        if let Some(p) = m.pays.get_mut(&o) {
            let tues = (p.pop / cases * poids).min(p.pop - 10.0).max(0.0);
            p.pop -= tues;
            p.troupes = (p.troupes - p.troupes / cases * poids).max(0.0);
            morts += tues;
        }
    }
    morts
}

/// Rayon (cases) du cratere creuse par l'antimatiere : il devient de la mer.
pub const RAYON_CRATERE: i64 = 1;

/// Impact d'une bombe a trou noir ou a antimatiere.
fn frappe_speciale(m: &mut Monde, pid: u32, genre: &str, cible: usize) {
    let trou_noir = genre == "bombe_trou_noir";
    let zone: Vec<(usize, f64)> = m.rayon(cible, 3).into_iter().map(|v| (v, if trou_noir { 0.98 } else { 0.9 })).collect();
    let defenseur = m.cases[cible].proprio;
    let morts = pertes_frappe(m, &zone);
    for &(v, _) in &zone {
        m.armees.retain(|_, a| a.case != v);
        let c = &mut m.cases[v];
        c.bat = None;
        c.niv = 0;
        // Les deux armes prennent toute la zone, meme au tireur.
        let ancien = c.proprio.take();
        if trou_noir {
            // Zone morte : plus personne, plus rien ne s'y construit.
            c.irradiee = m.temps + 1.0e9;
        } else {
            c.irradiee = m.temps + 1200.0;
        }
        if let Some(o) = ancien {
            if let Some(p) = m.pays.get_mut(&o) {
                p.chantiers.retain(|x| x.case != v);
                p.productions.retain(|x| x.case != v);
            }
        }
        m.toucher(v);
    }
    // Antimatiere : l'annihilation creuse un cratere au centre, que l'eau envahit.
    if !trou_noir {
        for v in m.rayon(cible, RAYON_CRATERE) {
            m.cases[v].terrain = T_MER;
            m.cases[v].depot = D_AUCUN;
            m.toucher(v);
        }
    }
    // Les capitales avalees se replient ailleurs.
    let sans_capitale: Vec<u32> = m.pays.values().filter(|p| !p.elimine && m.cases[p.capitale].proprio != Some(p.id)).map(|p| p.id).collect();
    for o in sans_capitale {
        relocaliser_capitale(m, o);
    }
    m.effets.push(Effet { genre: if trou_noir { "trou_noir" } else { "antimatiere" }.into(), case: cible, rayon: 3 });
    let nom_att = m.nom_pays(pid);
    let cible_nom = defenseur.map(|d| m.nom_pays(d)).unwrap_or_else(|| "une zone neutre".into());
    let quoi = if trou_noir { "UN TROU NOIR A AVALÉ" } else { "ANNIHILATION : l'antimatière a frappé" };
    m.evenement(None, "nucleaire", format!("{} {} (tiré par {}) : {} milliers de morts.", quoi, cible_nom, nom_att, morts.round()), Some(cible));
}

// ══════════════════════════════════════════════════════════════════
// Tick
// ══════════════════════════════════════════════════════════════════
pub fn tick(m: &mut Monde, dt: f64) -> HashMap<u32, Bilan> {
    m.temps += dt;
    let mut rng = rand::thread_rng();
    let bl = bilans(m);
    let maint = maintenant();
    let dm = dt / 60.0;

    // ── Economie, recherche, chantiers, productions ──
    let ids: Vec<u32> = m.pays.keys().copied().collect();
    let mut nouvelles_unites: Vec<(u32, usize, String, u32)> = Vec::new();
    let mut chantiers_finis: Vec<(u32, Chantier)> = Vec::new();
    let mut techs_finies: Vec<(u32, String)> = Vec::new();
    let mut desertion: Vec<u32> = Vec::new();
    let mut evts_fab: Vec<(u32, String)> = Vec::new();

    for pid in &ids {
        let Some(b) = bl.get(pid) else { continue };
        let p = m.pays.get_mut(pid).unwrap();
        if p.elimine {
            continue;
        }
        // Le stockage limite seulement ce que la PRODUCTION ajoute : ce qui
        // est deja au-dessus (dons de l'admin, achats, butin) n'est pas perdu.
        for i in 0..NB_RES {
            let delta = (b.prod[i] - b.conso[i]) * dm;
            let plafond = if i == CR { b.stock * 20.0 } else { b.stock };
            p.res[i] = if delta > 0.0 {
                if p.res[i] >= plafond { p.res[i] } else { (p.res[i] + delta).min(plafond) }
            } else {
                (p.res[i] + delta).max(0.0)
            };
        }
        if p.res[CR] <= 0.0 && b.prod[CR] < b.conso[CR] {
            desertion.push(*pid);
        }
        // Population
        if p.res[NO] <= 0.0 && b.prod[NO] < b.conso[NO] {
            p.pop *= 1.0 - 0.02 * dm;
        } else if p.pop < b.pop_cap {
            p.pop += (b.pop_cap - p.pop) * 0.04 * b.croissance * dm;
        } else {
            p.pop -= (p.pop - b.pop_cap) * 0.1 * dm;
        }
        p.pop = p.pop.max(10.0);
        p.influence = (p.influence + b.influence * dm).min(1000.0);

        // Uranium : enrichissement puis consommation des centrales
        let capacite = b.n("enrichissement") * b.elec_ratio * dm;
        let brut = (capacite * 1.5).min(p.res[UR]);
        p.res[UR] -= brut;
        p.ur_enrichi = (p.ur_enrichi + brut / 1.5).min(b.stock);
        p.ur_enrichi = (p.ur_enrichi - 0.4 * b.n("centrale_nucleaire") * dm).max(0.0);

        // Recherche
        let pts = b.recherche * dm;
        match p.recherche.clone() {
            Some(t) => {
                p.recherche_prog += pts;
                let cout = cout_recherche(p, &t).unwrap_or(0.0);
                if p.recherche_prog >= cout {
                    let surplus = p.recherche_prog - cout;
                    match t.strip_prefix("am:") {
                        Some(a) => *p.amelio.entry(a.to_string()).or_insert(0) += 1,
                        None => p.techs.push(t.clone()),
                    }
                    p.recherche = None;
                    p.recherche_prog = 0.0;
                    p.recherche_stock += surplus;
                    techs_finies.push((*pid, t));
                    // Suivante dans la file
                    while !p.file_recherche.is_empty() {
                        let n = p.file_recherche.remove(0);
                        if let Some(c) = cout_recherche(p, &n) {
                            let pris = p.recherche_stock.min(c);
                            p.recherche_stock -= pris;
                            p.recherche_prog = pris;
                            p.recherche = Some(n);
                            break;
                        }
                    }
                }
            }
            None => p.recherche_stock += pts,
        }

        // Chantiers : plus de file d'attente, tous avancent en meme temps.
        let vit = b.vitesse * dt;
        for c in p.chantiers.iter_mut() {
            c.reste -= vit;
        }

        // Minerais, raffinerie, fabrique, desintegration des legendaires.
        for t in fabriquer(p, b, dt) {
            evts_fab.push((*pid, t));
        }
        let (finis, encours): (Vec<Chantier>, Vec<Chantier>) = p.chantiers.drain(..).partition(|c| c.reste <= 0.0);
        p.chantiers = encours;
        for c in finis {
            chantiers_finis.push((*pid, c));
        }

        // Productions : une file par batiment producteur
        let robot = 1.0 + 0.07 * p.niv("robotique");
        let mut vues: HashSet<usize> = HashSet::new();
        for pr in p.productions.iter_mut() {
            if vues.insert(pr.case) {
                let niv = m.cases[pr.case].niv.max(1) as f64;
                pr.reste -= dt * (1.0 + 0.25 * (niv - 1.0)) * (1.0 + (b.vitesse - 1.0) * 0.5) * robot;
            }
        }
        let (faites, restantes): (Vec<Production>, Vec<Production>) = p.productions.drain(..).partition(|x| x.reste <= 0.0);
        p.productions = restantes;
        for f in faites {
            nouvelles_unites.push((*pid, f.case, f.unite, f.qte));
        }
    }

    for (pid, t) in evts_fab {
        m.evenement(Some(pid), "construction", t, None);
    }
    for (pid, t) in techs_finies {
        let nom = match t.strip_prefix("am:") {
            Some(a) => format!("{} niveau {}", nom_recherche(&t).unwrap_or_default(), m.pays[&pid].niv(a)),
            None => nom_recherche(&t).unwrap_or_default(),
        };
        m.evenement(Some(pid), "recherche", format!("Recherche terminée : {}.", nom), None);
    }

    for (pid, c) in chantiers_finis {
        let i = c.case;
        if m.cases[i].proprio != Some(pid) {
            continue;
        }
        let deja = m.cases[i].bat.clone();
        if deja.is_some() && deja.as_deref() != Some(c.bat.as_str()) {
            continue;
        }
        if c.bat == "centrale_nucleaire" && !m.pays[&pid].a("ind_nucleaire_civil") && rng.gen_bool(RISQUE_ACCIDENT) {
            accident_nucleaire(m, pid, i, &mut rng);
            continue;
        }
        m.cases[i].bat = Some(c.bat.clone());
        m.cases[i].niv = c.niv;
        m.cases[i].degats = 0.0;
        m.toucher(i);
        let nom = bat(&c.bat).map(|d| d.nom).unwrap_or("?");
        m.evenement(Some(pid), "construction", format!("{} niveau {} terminé.", nom, c.niv), Some(i));
    }

    for (pid, case, u, qte) in nouvelles_unites {
        let def = unite(&u);
        let ok = m.cases[case].proprio == Some(pid) && def.map(|d| m.cases[case].bat.as_deref() == Some(d.batiment)).unwrap_or(false);
        if !ok {
            continue;
        }
        let mut lot = BTreeMap::new();
        lot.insert(u.clone(), qte);
        deposer_unites(m, pid, case, &lot);
        let nom = def.map(|d| d.nom).unwrap_or("?");
        m.evenement(Some(pid), "militaire", format!("{} × {} prêts au combat.", qte, nom), Some(case));
    }

    // Desertion faute de solde : environ une unite par type toutes les 2 min.
    for pid in desertion {
        let ids_a: Vec<u32> = m.armees.values().filter(|a| a.proprio == pid).map(|a| a.id).collect();
        let mut parti = false;
        for id in ids_a {
            let a = m.armees.get_mut(&id).unwrap();
            for n in a.unites.values_mut() {
                if *n > 0 && rng.gen::<f64>() < 0.05 * dm * 10.0 {
                    *n -= 1;
                    parti = true;
                }
            }
            a.unites.retain(|_, n| *n > 0);
        }
        if parti && rng.gen::<f64>() < 0.2 {
            m.evenement(Some(pid), "alerte", "Caisses vides : des soldats désertent faute de solde !".into(), None);
        }
    }

    // ── Diplomatie : expirations ──
    m.propositions.retain(|p| maint - p.t < DUREE_PROPOSITION);
    let expirees: Vec<String> = m
        .relations
        .iter()
        .filter(|(_, r)| r.etat == Etat::Pna && r.jusqu <= maint)
        .map(|(k, _)| k.clone())
        .collect();
    for k in expirees {
        if let Some(r) = m.relations.get_mut(&k) {
            r.etat = Etat::Paix;
            r.depuis = maint;
        }
    }

    // ── Mouvements ──
    mouvements(m, dt);
    // ── Combats ──
    combats(m, dt);
    // ── Bombardements ──
    bombardements(m, dt);
    // ── Missions aeriennes ──
    missions(m, dt, &mut rng);
    // ── Missiles ──
    missiles(m, dt, &mut rng);
    nuages(m, dt, &mut rng);
    inventions(m, &bl, dt, &mut rng);
    // ── Troupes et offensives (facon OpenFront) ──
    front::reserves(m, &bl, dt);
    front::avancer(m, dt);
    if (m.temps / 5.0).floor() != ((m.temps - dt) / 5.0).floor() {
        encerclements(m);
    }

    m.armees.retain(|_, a| !a.unites.is_empty());

    // ── Marche : marche aleatoire, chocs, retour lent vers la reference ──
    marche(m, dt, &mut rng);

    // ── Eliminations ──
    let elimines: Vec<u32> = m
        .pays
        .values()
        .filter(|p| !p.elimine && bl.get(&p.id).map(|b| b.cases == 0).unwrap_or(false))
        .map(|p| p.id)
        .collect();
    for pid in elimines {
        eliminer(m, pid);
    }

    // Les bilans sont recalcules apres la simulation pour l'envoi.
    bilans(m)
}

/// Retire une nation et rend toutes ses terres neutres (administration).
fn supprimer_pays(m: &mut Monde, cible: u32) {
    for c in m.cases.iter_mut().filter(|c| c.proprio == Some(cible)) {
        c.proprio = None;
        if c.bat.is_some() {
            c.bat = None;
            c.niv = 0;
        }
    }
    for i in 0..m.cases.len() {
        if m.cases[i].proprio.is_none() {
            m.rev += 1;
            m.cases[i].rev = m.rev;
        }
    }
    eliminer(m, cible);
    m.attaques.retain(|_, a| a.cible != Some(cible));
    m.pays.remove(&cible);
}

fn eliminer(m: &mut Monde, pid: u32) {
    m.armees.retain(|_, a| a.proprio != pid);
    m.attaques.retain(|_, a| a.de != pid);
    m.missions.retain(|_, a| a.proprio != pid);
    quitter_bloc(m, pid);
    let nom = m.nom_pays(pid);
    if let Some(p) = m.pays.get_mut(&pid) {
        p.elimine = true;
        p.chantiers.clear();
        p.productions.clear();
    }
    m.relations.retain(|k, _| !k.split('-').any(|x| x == pid.to_string()));
    m.evenement(None, "guerre", format!("{} a été rayé de la carte.", nom), None);
    m.evenement(Some(pid), "alerte", "Votre nation a été anéantie. Vous pouvez en refonder une.".into(), None);
}

fn mouvements(m: &mut Monde, dt: f64) {
    let ids: Vec<u32> = m.armees.keys().copied().collect();
    for id in ids {
        let Some(a) = m.armees.get(&id) else { continue };
        if a.chemin.is_empty() || a.assaut.is_some() {
            continue;
        }
        let pid = a.proprio;
        let dom = domaine(a);
        let suivante = a.chemin[0];
        let amphibie = dom == DOM_TERRE && m.pays.get(&pid).map(|p| p.a("mil_amphibie")).unwrap_or(false);
        let cout = match cout_case(m, pid, dom, amphibie, suivante) {
            Some(c) => c,
            None => {
                let a = m.armees.get_mut(&id).unwrap();
                a.chemin.clear();
                a.progres = 0.0;
                m.evenement(Some(pid), "alerte", "Déplacement interrompu : passage refusé.".into(), Some(suivante));
                continue;
            }
        };
        let vitesse = vitesse_armee(a);
        let a = m.armees.get_mut(&id).unwrap();
        a.progres += dt * vitesse / 60.0 / cout;
        if a.progres < 1.0 {
            continue;
        }
        // Arrivee sur la case suivante : y a-t-il des ennemis ?
        let ennemis = m
            .armees
            .values()
            .any(|x| x.case == suivante && est_combattante(x) && hostile(m, pid, x.proprio));
        if ennemis {
            let a = m.armees.get_mut(&id).unwrap();
            a.assaut = Some(suivante);
            a.progres = 1.0;
            continue;
        }
        let a = m.armees.get_mut(&id).unwrap();
        a.case = suivante;
        a.chemin.remove(0);
        a.progres = if a.chemin.is_empty() { 0.0 } else { a.progres - 1.0 };
        let c = &m.cases[suivante];
        if dom == DOM_TERRE && est_terre(c.terrain) {
            if let Some(o) = c.proprio {
                if o != pid && m.en_guerre(pid, o) {
                    capturer(m, pid, suivante);
                }
            }
        }
    }
}

fn combats(m: &mut Monde, dt: f64) {
    // 1. Assauts : armees qui attaquent une case voisine.
    let mut cibles: BTreeMap<usize, Vec<u32>> = BTreeMap::new();
    for a in m.armees.values() {
        if let Some(t) = a.assaut {
            cibles.entry(t).or_default().push(a.id);
        }
    }
    // 2. Armees ennemies sur une meme case (rencontres en mer...).
    let mut par_case: BTreeMap<usize, Vec<u32>> = BTreeMap::new();
    for a in m.armees.values() {
        if est_combattante(a) && a.assaut.is_none() {
            par_case.entry(a.case).or_default().push(a.id);
        }
    }

    let mut engagements: Vec<(usize, Vec<u32>, Vec<u32>, bool)> = Vec::new();
    for (t, att) in cibles {
        let Some(chef) = att.first().and_then(|i| m.armees.get(i)).map(|a| a.proprio) else { continue };
        let def: Vec<u32> = m
            .armees
            .values()
            .filter(|x| x.case == t && est_combattante(x) && hostile(m, chef, x.proprio))
            .map(|x| x.id)
            .collect();
        engagements.push((t, att, def, true));
    }
    for (t, ids) in par_case {
        if ids.len() < 2 {
            continue;
        }
        let chef = m.armees[&ids[0]].proprio;
        let (a, b): (Vec<u32>, Vec<u32>) = ids.iter().partition(|i| {
            let o = m.armees[i].proprio;
            !hostile(m, chef, o)
        });
        if !b.is_empty() {
            engagements.push((t, a, b, false));
        }
    }

    for (case, att, def, assaut) in engagements {
        let att: Vec<u32> = att.into_iter().filter(|i| m.armees.contains_key(i)).collect();
        let def: Vec<u32> = def.into_iter().filter(|i| m.armees.get(i).map(|a| !a.unites.is_empty()).unwrap_or(false)).collect();
        if att.is_empty() {
            continue;
        }
        if def.is_empty() {
            // Plus personne en face : l'assaut se transforme en avance.
            for id in &att {
                if let Some(a) = m.armees.get_mut(id) {
                    a.assaut = None;
                }
            }
            continue;
        }
        let proprio_att = m.armees[&att[0]].proprio;
        let proprio_def = m.armees[&def[0]].proprio;

        let (at, am, adef, _) = composition(m, &att);
        let (dt_, dm_, ddef, _) = composition(m, &def);
        let c = &m.cases[case];
        let mut bonus = 0.0;
        if assaut && est_terre(c.terrain) {
            bonus += TERRAINS[c.terrain as usize].defense;
            if c.bat.as_deref() == Some("fort") && c.proprio == Some(proprio_def) {
                bonus += 0.3 * c.niv as f64;
            }
            if c.bat.as_deref() == Some("capitale") && c.proprio == Some(proprio_def) {
                bonus += 0.25;
            }
            if c.proprio == Some(proprio_def) && m.pays.get(&proprio_def).map(|p| p.spe == "forteresse").unwrap_or(false) {
                bonus += 0.25;
            }
        }
        let feu_att = puissance_feu(m, &att, dt_, dm_);
        let feu_def = puissance_feu(m, &def, at, am);
        let dmg_def = feu_att * K_COMBAT * dt * 60.0 / (60.0 + ddef * (1.0 + bonus));
        let dmg_att = feu_def * K_COMBAT * dt * 60.0 / (60.0 + adef);

        let (_, p_def) = blesser_armees(m, &def, dmg_def);
        let (_, p_att) = blesser_armees(m, &att, dmg_att);
        if let Some(p) = m.pays.get_mut(&proprio_att) {
            p.stats.unites_detruites += p_def;
            p.stats.unites_perdues += p_att;
        }
        if let Some(p) = m.pays.get_mut(&proprio_def) {
            p.stats.unites_detruites += p_att;
            p.stats.unites_perdues += p_def;
        }

        let def_vivant = def.iter().any(|i| m.armees.get(i).map(|a| !a.unites.is_empty()).unwrap_or(false));
        let att_vivant = att.iter().any(|i| m.armees.get(i).map(|a| !a.unites.is_empty()).unwrap_or(false));
        if !def_vivant {
            for id in &att {
                if let Some(a) = m.armees.get_mut(id) {
                    a.assaut = None;
                }
            }
            if let Some(p) = m.pays.get_mut(&proprio_att) { p.stats.combats_gagnes += 1; }
            if let Some(p) = m.pays.get_mut(&proprio_def) { p.stats.combats_perdus += 1; }
            let (na, nd) = (m.nom_pays(proprio_att), m.nom_pays(proprio_def));
            m.evenement(Some(proprio_att), "victoire", format!("Victoire : les forces de {} ont été écrasées.", nd), Some(case));
            m.evenement(Some(proprio_def), "alerte", format!("Défaite : vos troupes ont été anéanties par {}.", na), Some(case));
            m.effets.push(Effet { genre: "bataille".into(), case, rayon: 0 });
        } else if !att_vivant {
            if let Some(p) = m.pays.get_mut(&proprio_def) { p.stats.combats_gagnes += 1; }
            if let Some(p) = m.pays.get_mut(&proprio_att) { p.stats.combats_perdus += 1; }
            let (na, nd) = (m.nom_pays(proprio_att), m.nom_pays(proprio_def));
            m.evenement(Some(proprio_def), "victoire", format!("L'assaut de {} a été repoussé.", na), Some(case));
            m.evenement(Some(proprio_att), "alerte", format!("Votre assaut contre {} a échoué.", nd), Some(case));
        } else if rand::thread_rng().gen::<f64>() < 0.25 {
            m.effets.push(Effet { genre: "combat".into(), case, rayon: 0 });
        }
    }
    m.armees.retain(|_, a| !a.unites.is_empty());
}

fn bombardements(m: &mut Monde, dt: f64) {
    let ids: Vec<u32> = m.armees.values().filter(|a| a.bombarde.is_some()).map(|a| a.id).collect();
    for id in ids {
        let Some(a) = m.armees.get(&id) else { continue };
        let cible = a.bombarde.unwrap();
        let pid = a.proprio;
        let d = m.distance(a.case, cible) as f64;
        let Some(p) = m.pays.get(&pid) else { continue };
        let (mut feu_sol, mut feu_mer) = (0.0, 0.0);
        for (t, n) in &a.unites {
            let Some(u) = unite(t) else { continue };
            if u.portee >= d && u.portee > 0.0 && u.domaine != DOM_AIR && u.domaine != DOM_MISSILE {
                feu_sol += *n as f64 * u.att_sol * mod_attaque(p, u);
                feu_mer += *n as f64 * u.att_mer * mod_attaque(p, u);
            }
        }
        if feu_sol + feu_mer <= 0.0 {
            continue;
        }
        let ennemis: Vec<u32> = m
            .armees
            .values()
            .filter(|x| x.case == cible && hostile(m, pid, x.proprio))
            .map(|x| x.id)
            .collect();
        if !ennemis.is_empty() {
            let (t, s, def, _) = composition(m, &ennemis);
            let tot = (t + s).max(1.0);
            let feu = feu_sol * t / tot + feu_mer * s / tot;
            let dmg = feu * K_COMBAT * 0.7 * dt * 60.0 / (60.0 + def);
            let (_, pu) = blesser_armees(m, &ennemis, dmg);
            if let Some(p) = m.pays.get_mut(&pid) {
                p.stats.unites_detruites += pu;
            }
        } else if let Some(o) = m.cases[cible].proprio {
            if hostile(m, pid, o) {
                endommager_batiment(m, cible, feu_sol * K_COMBAT * 0.35 * dt);
            } else {
                m.armees.get_mut(&id).unwrap().bombarde = None;
                continue;
            }
        }
        if rand::thread_rng().gen::<f64>() < 0.3 {
            m.effets.push(Effet { genre: "obus".into(), case: cible, rayon: 0 });
        }
    }
}

fn missions(m: &mut Monde, dt: f64, rng: &mut impl Rng) {
    let ids: Vec<u32> = m.missions.keys().copied().collect();
    for id in ids {
        let mi = m.missions.get_mut(&id).unwrap();
        mi.progres += dt / mi.duree.max(1.0);
        if mi.progres < 1.0 {
            continue;
        }
        if mi.retour {
            let mi = m.missions.remove(&id).unwrap();
            let base_ok = m.cases[mi.base].proprio == Some(mi.proprio) && m.cases[mi.base].bat.as_deref() == Some("aeroport");
            let base = if base_ok {
                Some(mi.base)
            } else {
                (0..m.cases.len()).find(|&i| m.cases[i].proprio == Some(mi.proprio) && m.cases[i].bat.as_deref() == Some("aeroport"))
            };
            match base {
                Some(b) => deposer_unites(m, mi.proprio, b, &mi.unites),
                None => m.evenement(Some(mi.proprio), "alerte", "Plus aucune base aérienne : l'escadre est perdue.".into(), None),
            }
            continue;
        }
        // ── Arrivee sur la cible ──
        let mi = m.missions.get(&id).unwrap().clone();
        let pid = mi.proprio;
        let cible = mi.cible;
        let proprio_cible = m.cases[cible].proprio;
        let ennemis: Vec<u32> = m
            .armees
            .values()
            .filter(|x| x.case == cible && est_combattante(x) && hostile(m, pid, x.proprio))
            .map(|x| x.id)
            .collect();
        let cible_valide = !ennemis.is_empty() || proprio_cible.map(|o| hostile(m, pid, o)).unwrap_or(false);
        if !cible_valide {
            let mm = m.missions.get_mut(&id).unwrap();
            mm.retour = true;
            mm.progres = 0.0;
            m.evenement(Some(pid), "alerte", "Mission annulée : la cible n'est plus hostile.".into(), Some(cible));
            continue;
        }

        // Defense antiaerienne
        let mut aa = 0.0;
        for v in m.rayon(cible, 2) {
            let c = &m.cases[v];
            if c.bat.as_deref() == Some("defense_aa") && c.proprio.map(|o| hostile(m, pid, o)).unwrap_or(false) && c.irradiee <= m.temps {
                aa += 25.0 * c.niv as f64;
            }
        }
        for eid in &ennemis {
            for (t, n) in &m.armees[eid].unites {
                if let Some(u) = unite(t) {
                    aa += u.att_air * *n as f64;
                }
            }
        }
        // Chasseurs ennemis en alerte dans un rayon de 4 cases
        let intercepteurs: Vec<u32> = m
            .armees
            .values()
            .filter(|x| domaine(x) == DOM_AIR && hostile(m, pid, x.proprio) && m.distance(x.case, cible) <= 4)
            .map(|x| x.id)
            .collect();
        let mut chasse_def = 0.0;
        for iid in &intercepteurs {
            for (t, n) in &m.armees[iid].unites {
                if let Some(u) = unite(t) {
                    chasse_def += u.att_air * *n as f64 * 0.8;
                }
            }
        }
        let mut escorte = 0.0;
        for (t, n) in &mi.unites {
            if let Some(u) = unite(t) {
                escorte += u.att_air * *n as f64;
            }
        }
        // L'escorte engage d'abord la chasse ennemie
        if chasse_def > 0.0 && escorte > 0.0 {
            blesser_armees(m, &intercepteurs, escorte * 1.2);
        }
        let menace = aa + (chasse_def - escorte * 0.5).max(0.0);
        let mut unites = mi.unites.clone();
        let mut blessures = BTreeMap::new();
        let (perdus, _) = blesser(&mut unites, &mut blessures, menace * 1.5 * (0.7 + rng.gen::<f64>() * 0.6));

        // Frappe
        let mut feu_sol = 0.0;
        let mut feu_mer = 0.0;
        if let Some(p) = m.pays.get(&pid) {
            for (t, n) in &unites {
                if let Some(u) = unite(t) {
                    feu_sol += u.att_sol * *n as f64 * mod_attaque(p, u);
                    feu_mer += u.att_mer * *n as f64 * mod_attaque(p, u);
                }
            }
        }
        let mut detruits = 0.0;
        let bat_touche = ennemis.is_empty() && m.cases[cible].bat.is_some();
        if !ennemis.is_empty() {
            let (t, s, _, _) = composition(m, &ennemis);
            let tot = (t + s).max(1.0);
            let (tu, pu) = blesser_armees(m, &ennemis, (feu_sol * t / tot + feu_mer * s / tot) * 3.0);
            detruits = tu;
            if let Some(p) = m.pays.get_mut(&pid) {
                p.stats.unites_detruites += pu;
            }
        } else {
            endommager_batiment(m, cible, feu_sol * 1.2);
        }
        m.armees.retain(|_, a| !a.unites.is_empty());
        m.effets.push(Effet { genre: "frappe".into(), case: cible, rayon: 0 });

        let nom_att = m.nom_pays(pid);
        m.evenement(
            Some(pid),
            "militaire",
            if bat_touche {
                format!("Frappe aérienne menée : infrastructures ennemies bombardées, {} appareils perdus.", perdus)
            } else {
                format!("Frappe aérienne menée : {} unités ennemies détruites, {} appareils perdus.", detruits, perdus)
            },
            Some(cible),
        );
        if let Some(o) = proprio_cible {
            if o != pid {
                m.evenement(Some(o), "alerte", format!("Raid aérien de {} ! {} appareils abattus.", nom_att, perdus), Some(cible));
            }
        }
        if unites.is_empty() {
            m.missions.remove(&id);
        } else {
            let mm = m.missions.get_mut(&id).unwrap();
            mm.unites = unites;
            mm.retour = true;
            mm.progres = 0.0;
        }
    }
}

fn missiles(m: &mut Monde, dt: f64, rng: &mut impl Rng) {
    let ids: Vec<u32> = m.missiles.keys().copied().collect();
    for id in ids {
        let mv = m.missiles.get_mut(&id).unwrap();
        mv.progres += dt / mv.duree.max(1.0);
        if mv.progres < 1.0 {
            continue;
        }
        let mv = m.missiles.remove(&id).unwrap();
        let pid = mv.proprio;
        let cible = mv.cible;
        let nucleaire = mv.genre == "missile_nucleaire";
        let defenseur = m.cases[cible].proprio;
        if mv.genre == "bombe_trou_noir" || mv.genre == "bombe_antimatiere" {
            frappe_speciale(m, pid, &mv.genre, cible);
            continue;
        }

        // Interception par les batteries du defenseur et de son bloc
        let mut niveaux = 0.0;
        let mut bouclier = false;
        if let Some(d) = defenseur {
            for v in m.rayon(cible, 3) {
                let c = &m.cases[v];
                if c.bat.as_deref() == Some("defense_aa") && c.irradiee <= m.temps {
                    if let Some(o) = c.proprio {
                        if o == d || m.meme_bloc(o, d) {
                            niveaux += c.niv as f64;
                            if m.pays.get(&o).map(|p| p.a("mil_bouclier")).unwrap_or(false) {
                                bouclier = true;
                            }
                        }
                    }
                }
            }
        }
        let chance = if nucleaire {
            if bouclier { (0.1 * niveaux).min(0.6) } else { 0.0 }
        } else {
            (0.08 * niveaux * if bouclier { 1.5 } else { 1.0 }).min(0.75)
        };
        // Radars et boucliers fabriques par le defenseur.
        let chance = (chance + defenseur.and_then(|d| m.pays.get(&d)).map(|p| fab::effet(&p.stock, "interception")).unwrap_or(0.0)).min(0.9);
        let nom_att = m.nom_pays(pid);
        let nom_u = unite(&mv.genre).map(|u| u.nom).unwrap_or("Missile");
        if rng.gen::<f64>() < chance {
            m.effets.push(Effet { genre: "interception".into(), case: cible, rayon: 0 });
            m.evenement(Some(pid), "alerte", format!("{} intercepté par la défense adverse.", nom_u), Some(cible));
            if let Some(d) = defenseur {
                m.evenement(Some(d), "victoire", format!("{} de {} intercepté !", nom_u, nom_att), Some(cible));
            }
            if nucleaire {
                m.evenement(None, "nucleaire", format!("Un missile nucléaire de {} a été intercepté en vol.", nom_att), Some(cible));
            }
            continue;
        }

        let Some(u) = unite(&mv.genre) else { continue };
        if nucleaire {
            // Puissance proportionnelle a la matiere fissile embarquee (le
            // plutonium rend 1,5 fois plus que l'uranium enrichi), avec
            // jusqu'a +30 % si on double les explosifs de mise a feu.
            let kg = if mv.matiere > 0.0 { mv.matiere } else { 20.0 };
            let rend = puissance_nucleaire(&mv.fissile, kg, mv.explosifs);
            let k = rend / 20.0;
            // Pas de plafond : une charge assez grosse couvre toute la carte.
            let rayon = rayon_nucleaire(rend).clamp(1, m.largeur.max(m.hauteur) as i64);
            let coeur = ((rayon + 1) / 2).max(1);
            let zone: Vec<(usize, f64)> = m
                .rayon(cible, rayon)
                .into_iter()
                .map(|v| (v, if m.distance(cible, v) <= coeur { 0.9 } else { 0.35 } * k.sqrt().min(1.5)))
                .collect();
            let morts = pertes_frappe(m, &zone);
            for &(v, _) in &zone {
                let au_coeur = m.distance(cible, v) <= coeur;
                let facteur = if au_coeur { 1.0 } else { 0.45 };
                let victimes: Vec<u32> = m.armees.values().filter(|a| a.case == v && a.proprio != pid).map(|a| a.id).collect();
                let (_, pu) = blesser_armees(m, &victimes, u.att_sol * facteur * k);
                if let Some(p) = m.pays.get_mut(&pid) {
                    p.stats.unites_detruites += pu;
                }
                if m.cases[v].proprio.is_some() {
                    reduire_batiment(m, v, if au_coeur { 10 } else { (1.0 + rend / 15.0).min(10.0).round() as u8 });
                }
                // Le coeur de l'explosion est rase : la terre redevient neutre.
                if au_coeur {
                    if let Some(o) = m.cases[v].proprio {
                        if m.cases[v].bat.as_deref() == Some("capitale") {
                            m.cases[v].bat = None;
                            m.cases[v].niv = 0;
                        }
                        m.cases[v].proprio = None;
                        if let Some(p) = m.pays.get_mut(&o) {
                            p.chantiers.retain(|c| c.case != v);
                            p.productions.retain(|c| c.case != v);
                        }
                    }
                    m.armees.retain(|_, a| a.case != v);
                }
                m.cases[v].irradiee = m.temps + if au_coeur { 1800.0 } else { 900.0 } * k.sqrt().clamp(0.5, 4.0);
                m.toucher(v);
            }
            // Les capitales rasees se replient ailleurs.
            let sans_capitale: Vec<u32> = m
                .pays
                .values()
                .filter(|p| !p.elimine && m.cases[p.capitale].proprio != Some(p.id))
                .map(|p| p.id)
                .collect();
            for o in sans_capitale {
                relocaliser_capitale(m, o);
            }
            if let Some(p) = m.pays.get_mut(&pid) {
                p.influence = (p.influence - 200.0).max(0.0);
                p.stats.frappes_nucleaires += 1;
            }
            m.effets.push(Effet { genre: "nucleaire".into(), case: cible, rayon: rayon as u32 });
            let cible_nom = defenseur.map(|d| m.nom_pays(d)).unwrap_or_else(|| "une zone neutre".into());
            m.evenement(
                None,
                "nucleaire",
                format!("FRAPPE NUCLÉAIRE : {} a frappé {} ({}, rayon {} cases) : {} milliers de morts.", nom_att, cible_nom, charge_texte(&mv.fissile, kg), rayon, morts.round()),
                Some(cible),
            );
        } else {
            let (rayon, niv, dmg_voisins) = if mv.genre == "missile_balistique" { (1, 2, 0.3) } else { (0, 1, 0.0) };
            for v in m.rayon(cible, rayon) {
                let facteur = if v == cible { 1.0 } else { dmg_voisins };
                let victimes: Vec<u32> = m
                    .armees
                    .values()
                    .filter(|a| a.case == v && a.proprio != pid && !m.meme_bloc(pid, a.proprio))
                    .map(|a| a.id)
                    .collect();
                let (_, pu) = blesser_armees(m, &victimes, u.att_sol * facteur);
                if let Some(p) = m.pays.get_mut(&pid) {
                    p.stats.unites_detruites += pu;
                }
            }
            if m.cases[cible].proprio.map(|o| o != pid).unwrap_or(false) {
                reduire_batiment(m, cible, niv);
            }
            m.effets.push(Effet { genre: if mv.genre == "missile_balistique" { "balistique" } else { "explosion" }.into(), case: cible, rayon: rayon as u32 });
            m.evenement(Some(pid), "militaire", format!("{} : impact confirmé.", nom_u), Some(cible));
            if let Some(d) = defenseur {
                if d != pid {
                    m.evenement(Some(d), "alerte", format!("{} de {} a frappé votre territoire !", nom_u, nom_att), Some(cible));
                }
            }
        }
        m.armees.retain(|_, a| !a.unites.is_empty());
    }
}

// ══════════════════════════════════════════════════════════════════
// Commandes des joueurs
// ══════════════════════════════════════════════════════════════════
pub struct Joueur<'a> {
    pub user_id: i64,
    pub nom: &'a str,
    pub admin: bool,
    /// Uniquement en mode "dev" (jamais avec l'authentification VEX) :
    /// autorise la commande de test `dev_tout`.
    pub triche: bool,
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}
fn u(v: &Value, k: &str) -> Option<u64> {
    v.get(k).and_then(|x| x.as_u64())
}

pub fn pays_du_joueur(m: &Monde, user_id: i64) -> Option<u32> {
    m.pays.values().find(|p| p.user_id == user_id).map(|p| p.id)
}

fn couleur_valide(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())
}

fn texte_propre(t: &str, max: usize) -> String {
    t.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

pub fn commande(m: &mut Monde, j: &Joueur, cmd: &Value, regles: &Regles) -> Result<String, String> {
    let action = s(cmd, "action");
    let maint = maintenant();

    // ── Actions sans pays ──
    match action {
        "rejoindre" => return rejoindre(m, j, cmd, regles),
        "admin_annonce" if j.admin => {
            let t = texte_propre(s(cmd, "texte"), 300);
            if t.is_empty() {
                return Err("Annonce vide.".into());
            }
            m.evenement(None, "annonce", t, None);
            return Ok("Annonce publiée.".into());
        }
        "admin_donner" if j.admin => {
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            let p = m.pays.get_mut(&cible).ok_or("Pays introuvable.")?;
            if let Some(r) = cmd.get("res").and_then(|v| v.as_array()) {
                for (i, v) in r.iter().enumerate().take(NB_RES) {
                    p.res[i] = (p.res[i] + v.as_f64().unwrap_or(0.0)).max(0.0);
                }
            }
            if let Some(t) = cmd.get("troupes").and_then(|v| v.as_f64()) {
                p.troupes = (p.troupes + t).max(0.0);
            }
            if let Some(n) = cmd.get("elements").and_then(|v| v.as_f64()) {
                for e in fab::ELEMENTS.iter() {
                    fab::ajouter(&mut p.stock, e.id, n);
                }
            }
            // Un element ou un produit precis.
            let objet = s(cmd, "objet");
            if !objet.is_empty() {
                if fab::element(objet).is_none() && fab::produit(objet).is_none() {
                    return Err("Objet inconnu.".into());
                }
                let n = cmd.get("qte").and_then(|v| v.as_f64()).unwrap_or(1.0);
                fab::ajouter(&mut p.stock, objet, n);
            }
            if cmd.get("techs").and_then(|v| v.as_bool()).unwrap_or(false) {
                p.techs = TECHS.iter().map(|t| t.id.to_string()).collect();
                p.amelio = AMELIORATIONS.iter().map(|a| (a.id.to_string(), a.max)).collect();
            }
            // Unites livrees a la capitale (missiles et avions compris).
            let unite_id = s(cmd, "unite");
            if !unite_id.is_empty() {
                unite(unite_id).ok_or("Unité inconnue.")?;
                let n = u(cmd, "unites_qte").unwrap_or(1).clamp(1, 1000) as u32;
                let cap = p.capitale;
                let mut lot = BTreeMap::new();
                lot.insert(unite_id.to_string(), n);
                deposer_unites(m, cible, cap, &lot);
            }
            let p = m.pays.get(&cible).unwrap();
            let nom = p.nom.clone();
            return Ok(format!("Ressources envoyées à {}.", nom));
        }
        "admin_protection" if j.admin => {
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            let minutes = cmd.get("minutes").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 10_000.0);
            let p = m.pays.get_mut(&cible).ok_or("Pays introuvable.")?;
            p.protection = if minutes > 0.0 { maint + (minutes * 60.0) as i64 } else { 0 };
            return Ok(if minutes > 0.0 { format!("{} protégé {} min.", p.nom, minutes) } else { format!("Protection de {} levée.", p.nom) });
        }
        "admin_paix_mondiale" if j.admin => {
            let mut n = 0;
            for r in m.relations.values_mut() {
                if r.etat == Etat::Guerre {
                    r.etat = Etat::Paix;
                    r.depuis = maint;
                    n += 1;
                }
            }
            m.attaques.retain(|_, a| a.cible.is_none());
            for a in m.armees.values_mut() {
                a.assaut = None;
                a.bombarde = None;
            }
            m.evenement(None, "annonce", "L'administration impose la paix mondiale : toutes les guerres s'arrêtent.".into(), None);
            return Ok(format!("{} guerre(s) arrêtée(s).", n));
        }
        "admin_bots" if j.admin => {
            let nb = u(cmd, "nb").unwrap_or(0).min(16) as usize;
            m.bots_admin = Some(nb);
            // Les bots en trop disparaissent et leurs terres redeviennent neutres.
            let trop: Vec<u32> = m
                .pays
                .values()
                .filter(|p| crate::bots::est_bot(p.user_id) && crate::bots::rang_bot(p.user_id) >= nb)
                .map(|p| p.id)
                .collect();
            for pid in &trop {
                supprimer_pays(m, *pid);
            }
            // Et ceux qui manquent sont crees tout de suite.
            crate::bots::creer(m, nb, regles);
            return Ok(format!("{} nation(s) jouée(s) par l'ordinateur ({} retirée(s)).", nb, trop.len()));
        }
        "admin_nouvelle_carte" if j.admin => {
            let graine = rand::thread_rng().gen_range(1..u32::MAX as u64);
            let (l, h, bots) = (m.largeur, m.hauteur, m.bots_admin);
            *m = Monde::generer(l, h, graine);
            m.bots_admin = bots;
            m.evenement(None, "annonce", "Nouveau monde : l'administration a généré une nouvelle carte. Fondez votre nation !".into(), None);
            return Ok(format!("Nouvelle carte générée (graine {}).", graine));
        }
        "admin_supprimer_pays" if j.admin => {
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            if !m.pays.contains_key(&cible) {
                return Err("Pays introuvable.".into());
            }
            supprimer_pays(m, cible);
            return Ok("Pays supprimé.".into());
        }
        _ => {}
    }

    let pid = pays_du_joueur(m, j.user_id).ok_or("Vous n'avez pas encore de nation.")?;
    if let Some(p) = m.pays.get_mut(&pid) {
        p.actif = maint;
    }
    if action == "refonder" {
        if !m.pays[&pid].elimine {
            return Err("Votre nation existe encore.".into());
        }
        installer_pays(m, pid, regles)?;
        let nom = m.nom_pays(pid);
        m.evenement(None, "diplomatie", format!("{} renaît de ses cendres.", nom), Some(m.pays[&pid].capitale));
        return Ok("Nation refondée.".into());
    }
    if action == "dev_tout" && j.triche {
        let p = m.pays.get_mut(&pid).unwrap();
        p.techs = TECHS.iter().map(|t| t.id.to_string()).collect();
        p.amelio = AMELIORATIONS.iter().map(|a| (a.id.to_string(), a.max)).collect();
        p.recherche = None;
        p.file_recherche.clear();
        // Le maximum : de quoi tout construire, fabriquer et lancer.
        for r in p.res.iter_mut() {
            *r = r.max(10_000_000.0);
        }
        p.influence = p.influence.max(100_000.0);
        p.recherche_stock = p.recherche_stock.max(10_000_000.0);
        p.troupes = p.troupes.max(100_000.0);
        p.ur_enrichi = p.ur_enrichi.max(100_000.0);
        for e in fab::ELEMENTS.iter() {
            let manque = 100_000.0 - fab::qte(&p.stock, e.id);
            if manque > 0.0 {
                fab::ajouter(&mut p.stock, e.id, manque);
            }
        }
        for o in fab::tous_produits() {
            let manque = 1_000.0 - fab::qte(&p.stock, o.id);
            if manque > 0.0 {
                fab::ajouter(&mut p.stock, o.id, manque);
            }
        }
        return Ok("[dev] Le maximum : toutes les technologies, ressources, éléments et produits.".into());
    }
    if m.pays[&pid].elimine && action != "chat" {
        return Err("Votre nation a été anéantie : refondez-la pour rejouer.".into());
    }
    let b = bilans(m).remove(&pid).unwrap_or_default();

    match action {
        // ── Construction ──
        "construire" => {
            let i = u(cmd, "case").ok_or("Case manquante.")? as usize;
            let id = s(cmd, "bat");
            let d = bat(id).filter(|d| d.constructible).ok_or("Bâtiment inconnu.")?;
            let c = m.cases.get(i).ok_or("Case invalide.")?;
            if c.proprio != Some(pid) {
                return Err("Cette province ne vous appartient pas.".into());
            }
            if !est_terre(c.terrain) {
                return Err("Impossible de bâtir en mer.".into());
            }
            if c.bat.is_some() {
                return Err("Il y a déjà un bâtiment ici (améliorez-le ou démolissez-le).".into());
            }
            if c.irradiee > m.temps {
                return Err("Zone irradiée : construction impossible.".into());
            }
            let p = &m.pays[&pid];
            if !d.tech.is_empty() && !p.a(d.tech) {
                return Err(format!("Technologie requise : {}.", tech(d.tech).map(|t| t.nom).unwrap_or(d.tech)));
            }
            if d.depot != D_AUCUN && c.depot != d.depot {
                return Err(format!("Nécessite : {}.", DEPOTS[d.depot as usize].nom));
            }
            if d.cote && !m.est_cote(i) {
                return Err("Doit être construit sur une côte.".into());
            }
            if p.chantiers.iter().any(|x| x.case == i) {
                return Err("Un chantier est déjà en cours ici.".into());
            }
            if p.chantiers.len() >= 500 {
                return Err("Trop de chantiers en cours (500).".into());
            }
            let cout = cout_batiment(p, d, 1);
            if !peut_payer(p, &cout) {
                return Err(manque(&cout, p));
            }
            let t = temps_batiment(d, 1);
            let cid = m.nouvel_id();
            let p = m.pays.get_mut(&pid).unwrap();
            payer(p, &cout);
            p.chantiers.push(Chantier { id: cid, case: i, bat: id.into(), niv: 1, reste: t, total: t, });
            Ok(format!("Chantier lancé : {}.", d.nom))
        }
        "ameliorer" => {
            let i = u(cmd, "case").ok_or("Case manquante.")? as usize;
            let c = m.cases.get(i).ok_or("Case invalide.")?;
            if c.proprio != Some(pid) {
                return Err("Cette province ne vous appartient pas.".into());
            }
            let id = c.bat.clone().ok_or("Aucun bâtiment à améliorer.")?;
            let d = bat(&id).ok_or("Bâtiment inconnu.")?;
            if c.irradiee > m.temps {
                return Err("Zone irradiée.".into());
            }
            let p = &m.pays[&pid];
            if c.niv >= niveau_max(p) {
                return Err("Niveau maximal atteint.".into());
            }
            if p.chantiers.iter().any(|x| x.case == i) {
                return Err("Un chantier est déjà en cours ici.".into());
            }
            if p.chantiers.len() >= 500 {
                return Err("Trop de chantiers en cours (500).".into());
            }
            let niv = c.niv + 1;
            let cout = cout_batiment(p, d, niv);
            if !peut_payer(p, &cout) {
                return Err(manque(&cout, p));
            }
            let t = temps_batiment(d, niv);
            let cid = m.nouvel_id();
            let p = m.pays.get_mut(&pid).unwrap();
            payer(p, &cout);
            p.chantiers.push(Chantier { id: cid, case: i, bat: id.clone(), niv, reste: t, total: t });
            Ok(format!("Amélioration lancée : {} niveau {}.", d.nom, niv))
        }
        "demolir" => {
            let i = u(cmd, "case").ok_or("Case manquante.")? as usize;
            let c = m.cases.get(i).ok_or("Case invalide.")?;
            if c.proprio != Some(pid) {
                return Err("Cette province ne vous appartient pas.".into());
            }
            if c.bat.as_deref() == Some("capitale") {
                return Err("On ne démolit pas sa capitale.".into());
            }
            if c.bat.is_none() {
                return Err("Rien à démolir.".into());
            }
            m.cases[i].bat = None;
            m.cases[i].niv = 0;
            m.toucher(i);
            let p = m.pays.get_mut(&pid).unwrap();
            p.productions.retain(|x| x.case != i);
            p.chantiers.retain(|x| x.case != i);
            Ok("Bâtiment démoli.".into())
        }
        "annuler_chantier" => {
            let id = u(cmd, "id").ok_or("Chantier manquant.")? as u32;
            let p = m.pays.get(&pid).unwrap();
            let pos = p.chantiers.iter().position(|c| c.id == id).ok_or("Chantier introuvable.")?;
            let c = p.chantiers[pos].clone();
            let cout = bat(&c.bat).map(|d| cout_batiment(p, d, c.niv)).unwrap_or([0.0; NB_RES]);
            let p = m.pays.get_mut(&pid).unwrap();
            p.chantiers.remove(pos);
            rembourser(p, &cout, 0.5);
            Ok("Chantier annulé (50 % remboursés).".into())
        }
        // ── Troupes (facon OpenFront) : clic droit sur une case ──
        "etendre" | "annexer" => {
            let i = u(cmd, "case").ok_or("Case manquante.")? as usize;
            let ratio = cmd.get("ratio").and_then(|v| v.as_f64()).unwrap_or(0.3);
            front::etendre(m, pid, i, ratio, maint)
        }
        "rappeler" => {
            let id = u(cmd, "id").ok_or("Offensive manquante.")? as u32;
            front::rappeler(m, pid, id)
        }

        // ── Fabrication ──
        "raffiner" | "fabriquer" => commander_fabrication(m, pid, &b, action, cmd),
        "annuler_fabrication" => {
            let id = u(cmd, "id").ok_or("Commande manquante.")? as u32;
            let p = m.pays.get_mut(&pid).unwrap();
            let pos = p.fabrications.iter().position(|f| f.id == id).ok_or("Commande introuvable.")?;
            let f = p.fabrications.remove(pos);
            if f.paye {
                for (objet, q) in entrees_fabrication(&f.atelier, &f.objet, f.qte) {
                    fab::retirer(p, &objet, -q);
                }
            }
            Ok("Ligne arrêtée, matières rendues.".into())
        }
        // Reglage d'une ligne : automatique ou non, stock vise, taille du lot.
        "regler_fabrication" => {
            let id = u(cmd, "id").ok_or("Ligne manquante.")? as u32;
            let p = m.pays.get_mut(&pid).unwrap();
            let pos = p.fabrications.iter().position(|f| f.id == id).ok_or("Ligne introuvable.")?;
            if let Some(a) = cmd.get("auto").and_then(|v| v.as_bool()) {
                p.fabrications[pos].auto = a;
            }
            if let Some(c) = cmd.get("cible").and_then(|v| v.as_f64()) {
                p.fabrications[pos].cible = c.clamp(0.0, 1e7);
            }
            if let Some(q) = u(cmd, "qte") {
                let q = q.clamp(1, 1000) as u32;
                let f = p.fabrications[pos].clone();
                if q != f.qte {
                    // Le lot change : on rend les matieres deja prelevees, la
                    // ligne reprendra les nouvelles quantites.
                    if f.paye {
                        for (objet, n) in entrees_fabrication(&f.atelier, &f.objet, f.qte) {
                            fab::retirer(p, &objet, -n);
                        }
                    }
                    let unite = f.total / (f.qte.max(1) as f64).powf(0.75);
                    let l = &mut p.fabrications[pos];
                    l.qte = q;
                    l.total = duree_lot(unite, q);
                    l.reste = l.total;
                    l.paye = false;
                    if !l.auto {
                        // Une commande simple doit pouvoir payer tout de suite.
                        let entrees = entrees_fabrication(&l.atelier, &l.objet, q);
                        if entrees.iter().all(|(i, n)| fab::possede(p, i) + 1e-9 >= *n) {
                            for (i, n) in &entrees {
                                fab::retirer(p, i, *n);
                            }
                            p.fabrications[pos].paye = true;
                        } else {
                            p.fabrications[pos].auto = true;
                        }
                    }
                }
            }
            Ok("Ligne réglée.".into())
        }
        "vendre_objet" => {
            let objet = s(cmd, "objet");
            let q = cmd.get("qte").and_then(|v| v.as_f64()).unwrap_or(1.0).floor();
            if !(q >= 1.0) {
                return Err("Quantité invalide.".into());
            }
            let p = m.pays.get_mut(&pid).unwrap();
            if fab::qte(&p.stock, objet) + 1e-9 < q {
                return Err("Vous n'en avez pas assez.".into());
            }
            // Chaque unite vendue fait baisser le cours de 0,3 % (plancher 30 %).
            let cours = m.cours.get(objet).copied().unwrap_or(1.0);
            let apres = (cours * 0.997f64.powf(q)).max(0.3);
            let gain = (fab::prix_objet(objet) * (cours + apres) / 2.0 * q).floor();
            let p = m.pays.get_mut(&pid).unwrap();
            fab::ajouter(&mut p.stock, objet, -q);
            p.res[CR] += gain;
            m.cours.insert(objet.to_string(), apres);
            Ok(format!("{} × {} vendus pour {} crédits.", q, fab::nom_objet(objet), gain))
        }
        "acheter_objet" => {
            let objet = s(cmd, "objet");
            if fab::element(objet).is_none() && fab::produit(objet).is_none() {
                return Err("Objet inconnu.".into());
            }
            let q = cmd.get("qte").and_then(|v| v.as_f64()).unwrap_or(1.0).floor().clamp(0.0, 1000.0);
            if q < 1.0 {
                return Err("Quantité invalide.".into());
            }
            // Achat : prix de reference x 1,5, et le cours monte de 0,3 % par unite.
            let cours = m.cours.get(objet).copied().unwrap_or(1.0);
            let apres = (cours * 1.003f64.powf(q)).min(4.0);
            let cout = (fab::prix_objet(objet) * 1.5 * (cours + apres) / 2.0 * q).ceil();
            let p = m.pays.get_mut(&pid).unwrap();
            if p.res[CR] + 1e-9 < cout {
                return Err(format!("Il faut {} crédits.", cout));
            }
            p.res[CR] -= cout;
            fab::ajouter(&mut p.stock, objet, q);
            m.cours.insert(objet.to_string(), apres);
            Ok(format!("{} × {} achetés pour {} crédits.", q, fab::nom_objet(objet), cout))
        }
        "fabriquer_chaine" => fabriquer_chaine(m, pid, &b, cmd),
        "arme_speciale" => arme_speciale(m, pid, cmd, regles),

        // ── Recherche ──
        "acheter_plan" => {
            let id = s(cmd, "plan");
            let nom = nom_recherche(id).ok_or("Plan inconnu.")?;
            let prix = prix_plan(&m.pays[&pid], id).ok_or("Vous avez déjà ce plan.")?;
            let p = m.pays.get_mut(&pid).unwrap();
            if p.res[CR] + 1e-9 < prix {
                return Err(format!("Il faut {} crédits.", prix));
            }
            p.res[CR] -= prix;
            match id.strip_prefix("am:") {
                Some(a) => *p.amelio.entry(a.to_string()).or_insert(0) += 1,
                None => p.techs.push(id.to_string()),
            }
            Ok(format!("Plan acheté : {}.", nom))
        }
        "rechercher" => {
            let t = s(cmd, "tech");
            let nom = nom_recherche(t).ok_or("Recherche inconnue.")?;
            let p = m.pays.get_mut(&pid).unwrap();
            if p.recherche.as_deref() == Some(t) || p.file_recherche.iter().any(|x| x == t) {
                return Err("Déjà en file d'attente.".into());
            }
            let cout = cout_recherche(p, t).ok_or(if t.starts_with("am:") { "Niveau maximal atteint." } else { "Déjà recherchée." })?;
            if p.recherche.is_none() {
                let pris = p.recherche_stock.min(cout);
                p.recherche_stock -= pris;
                p.recherche_prog = pris;
                p.recherche = Some(t.into());
                Ok(format!("Recherche lancée : {}.", nom))
            } else {
                if p.file_recherche.len() >= 8 {
                    return Err("File de recherche pleine.".into());
                }
                p.file_recherche.push(t.into());
                Ok(format!("{} ajoutée à la file.", nom))
            }
        }
        "annuler_recherche" => {
            let t = s(cmd, "tech");
            let p = m.pays.get_mut(&pid).unwrap();
            if p.recherche.as_deref() == Some(t) {
                p.recherche_stock += p.recherche_prog;
                p.recherche_prog = 0.0;
                p.recherche = None;
                Ok("Recherche suspendue, points conservés.".into())
            } else {
                p.file_recherche.retain(|x| x != t);
                Ok("Retirée de la file.".into())
            }
        }

        // ── Production militaire ──
        "produire" => {
            let i = u(cmd, "case").ok_or("Case manquante.")? as usize;
            let qte = u(cmd, "qte").unwrap_or(1).clamp(1, 50) as u32;
            let ud = unite(s(cmd, "unite")).ok_or("Unité inconnue.")?;
            let c = m.cases.get(i).ok_or("Case invalide.")?;
            if c.proprio != Some(pid) || c.bat.as_deref() != Some(ud.batiment) {
                return Err(format!("Il faut produire depuis : {}.", bat(ud.batiment).map(|d| d.nom).unwrap_or("?")));
            }
            let p = &m.pays[&pid];
            if !ud.tech.is_empty() && !p.a(ud.tech) {
                return Err(format!("Technologie requise : {}.", tech(ud.tech).map(|t| t.nom).unwrap_or("?")));
            }
            if p.productions.len() >= 20 {
                return Err("Trop de commandes en cours (20).".into());
            }
            let cout = cout_unite(p, ud, qte);
            if !peut_payer(p, &cout) {
                return Err(manque(&cout, p));
            }
            let t = ud.temps * qte as f64;
            let cid = m.nouvel_id();
            let p = m.pays.get_mut(&pid).unwrap();
            payer(p, &cout);
            p.productions.push(Production { id: cid, case: i, unite: ud.id.into(), qte, reste: t, total: t });
            Ok(format!("Commande passée : {} × {}.", qte, ud.nom))
        }
        "annuler_production" => {
            let id = u(cmd, "id").ok_or("Commande manquante.")? as u32;
            let p = m.pays.get(&pid).unwrap();
            let pos = p.productions.iter().position(|c| c.id == id).ok_or("Commande introuvable.")?;
            let pr = p.productions[pos].clone();
            let cout = unite(&pr.unite).map(|ud| cout_unite(p, ud, pr.qte)).unwrap_or([0.0; NB_RES]);
            let p = m.pays.get_mut(&pid).unwrap();
            p.productions.remove(pos);
            rembourser(p, &cout, 0.5);
            Ok("Commande annulée (50 % remboursés).".into())
        }

        // ── Armees ──
        "deplacer" => {
            let aid = u(cmd, "armee").ok_or("Armée manquante.")? as u32;
            let cible = u(cmd, "cible").ok_or("Destination manquante.")? as usize;
            if cible >= m.cases.len() {
                return Err("Destination invalide.".into());
            }
            let a = m.armees.get(&aid).filter(|a| a.proprio == pid).ok_or("Armée introuvable.")?;
            let dom = domaine(a);
            if dom == DOM_AIR || dom == DOM_MISSILE {
                return Err("Les avions et missiles restent à leur base : utilisez une mission ou un tir.".into());
            }
            let depart = a.case;
            let ch = chemin(m, pid, depart, cible, dom).ok_or(match dom {
                DOM_MER => "Aucune route maritime vers cette destination.",
                _ => "Aucun itinéraire : territoire étranger non en guerre, mer (sans opérations amphibies) ou trop loin.",
            })?;
            let n = ch.len();
            let a = m.armees.get_mut(&aid).unwrap();
            a.chemin = ch;
            a.assaut = None;
            a.progres = 0.0;
            Ok(format!("En route ({} cases).", n))
        }
        "arreter" => {
            let aid = u(cmd, "armee").ok_or("Armée manquante.")? as u32;
            let a = m.armees.get_mut(&aid).filter(|a| a.proprio == pid).ok_or("Armée introuvable.")?;
            a.chemin.clear();
            a.assaut = None;
            a.progres = 0.0;
            a.bombarde = None;
            Ok("Ordre annulé : l'armée tient sa position.".into())
        }
        "scinder" => {
            let aid = u(cmd, "armee").ok_or("Armée manquante.")? as u32;
            let parts = cmd.get("unites").and_then(|x| x.as_object()).ok_or("Composition manquante.")?;
            let a = m.armees.get(&aid).filter(|a| a.proprio == pid).ok_or("Armée introuvable.")?;
            if !a.chemin.is_empty() || a.assaut.is_some() {
                return Err("Arrêtez d'abord l'armée.".into());
            }
            let mut lot = BTreeMap::new();
            for (t, n) in parts {
                let n = n.as_u64().unwrap_or(0) as u32;
                if n == 0 {
                    continue;
                }
                let dispo = *a.unites.get(t).unwrap_or(&0);
                if n > dispo {
                    return Err("Pas assez d'unités.".into());
                }
                lot.insert(t.clone(), n);
            }
            if lot.is_empty() || total_unites(&lot) >= total_unites(&a.unites) {
                return Err("Choisissez une partie des unités seulement.".into());
            }
            let case = a.case;
            let a = m.armees.get_mut(&aid).unwrap();
            for (t, n) in &lot {
                *a.unites.get_mut(t).unwrap() -= n;
            }
            a.unites.retain(|_, n| *n > 0);
            let nid = m.nouvel_id();
            let nom = format!("{}e division", nid);
            m.armees.insert(nid, Armee {
                id: nid, proprio: pid, case, unites: lot, blessures: BTreeMap::new(),
                chemin: vec![], progres: 0.0, bombarde: None, assaut: None, nom,
            });
            Ok("Armée scindée.".into())
        }
        "fusionner" => {
            let aid = u(cmd, "armee").ok_or("Armée manquante.")? as u32;
            let avec = u(cmd, "avec").ok_or("Seconde armée manquante.")? as u32;
            let a = m.armees.get(&aid).filter(|a| a.proprio == pid).ok_or("Armée introuvable.")?;
            let b2 = m.armees.get(&avec).filter(|a| a.proprio == pid).ok_or("Armée introuvable.")?;
            if aid == avec || a.case != b2.case || domaine(a) != domaine(b2) {
                return Err("Les armées doivent être sur la même case et du même type.".into());
            }
            let b2 = m.armees.remove(&avec).unwrap();
            let a = m.armees.get_mut(&aid).unwrap();
            for (t, n) in b2.unites {
                *a.unites.entry(t).or_insert(0) += n;
            }
            Ok("Armées fusionnées.".into())
        }
        "renommer_armee" => {
            let aid = u(cmd, "armee").ok_or("Armée manquante.")? as u32;
            let nom = texte_propre(s(cmd, "nom"), 32);
            if nom.is_empty() {
                return Err("Nom vide.".into());
            }
            let a = m.armees.get_mut(&aid).filter(|a| a.proprio == pid).ok_or("Armée introuvable.")?;
            a.nom = nom;
            Ok("Armée renommée.".into())
        }
        "dissoudre" => {
            let aid = u(cmd, "armee").ok_or("Armée manquante.")? as u32;
            m.armees.get(&aid).filter(|a| a.proprio == pid).ok_or("Armée introuvable.")?;
            m.armees.remove(&aid);
            Ok("Armée démobilisée.".into())
        }
        "bombarder" => {
            let aid = u(cmd, "armee").ok_or("Armée manquante.")? as u32;
            let cible = u(cmd, "cible").map(|x| x as usize);
            let a = m.armees.get(&aid).filter(|a| a.proprio == pid).ok_or("Armée introuvable.")?;
            let Some(cible) = cible else {
                m.armees.get_mut(&aid).unwrap().bombarde = None;
                return Ok("Bombardement arrêté.".into());
            };
            if cible >= m.cases.len() {
                return Err("Cible invalide.".into());
            }
            let portee = a.unites.keys().filter_map(|t| unite(t)).filter(|u| u.domaine == DOM_TERRE || u.domaine == DOM_MER).map(|u| u.portee).fold(0.0, f64::max);
            if portee <= 0.0 {
                return Err("Aucune unité de bombardement (artillerie, destroyer, porte-avions).".into());
            }
            if m.distance(a.case, cible) as f64 > portee {
                return Err(format!("Cible hors de portée ({} cases max).", portee));
            }
            let ok = m.cases[cible].proprio.map(|o| hostile(m, pid, o)).unwrap_or(false)
                || m.armees.values().any(|x| x.case == cible && hostile(m, pid, x.proprio));
            if !ok {
                return Err("La cible doit appartenir à une nation en guerre avec vous.".into());
            }
            m.armees.get_mut(&aid).unwrap().bombarde = Some(cible);
            Ok("Bombardement en cours.".into())
        }
        "mission" => {
            let aid = u(cmd, "armee").ok_or("Escadre manquante.")? as u32;
            let cible = u(cmd, "cible").ok_or("Cible manquante.")? as usize;
            if cible >= m.cases.len() {
                return Err("Cible invalide.".into());
            }
            let a = m.armees.get(&aid).filter(|a| a.proprio == pid).ok_or("Escadre introuvable.")?;
            if domaine(a) != DOM_AIR {
                return Err("Seules les escadres aériennes partent en mission.".into());
            }
            let mut lot: BTreeMap<String, u32> = BTreeMap::new();
            match cmd.get("unites").and_then(|x| x.as_object()) {
                Some(parts) => {
                    for (t, n) in parts {
                        let n = (n.as_u64().unwrap_or(0) as u32).min(*a.unites.get(t).unwrap_or(&0));
                        if n > 0 {
                            lot.insert(t.clone(), n);
                        }
                    }
                }
                None => lot = a.unites.clone(),
            }
            if lot.is_empty() {
                return Err("Aucun appareil sélectionné.".into());
            }
            let d = m.distance(a.case, cible) as f64;
            let portee = lot.keys().filter_map(|t| unite(t)).map(|u| u.portee).fold(f64::MAX, f64::min);
            if d > portee {
                return Err(format!("Cible hors du rayon d'action ({} cases).", portee));
            }
            let ok = m.cases[cible].proprio.map(|o| hostile(m, pid, o)).unwrap_or(false)
                || m.armees.values().any(|x| x.case == cible && hostile(m, pid, x.proprio));
            if !ok {
                return Err("La cible doit appartenir à une nation en guerre avec vous.".into());
            }
            let vitesse = lot.keys().filter_map(|t| unite(t)).map(|u| u.vitesse).fold(f64::MAX, f64::min);
            let duree = (d.max(1.0) / vitesse * 60.0).max(4.0);
            let base = a.case;
            let a = m.armees.get_mut(&aid).unwrap();
            for (t, n) in &lot {
                *a.unites.get_mut(t).unwrap() -= n;
            }
            a.unites.retain(|_, n| *n > 0);
            let mid = m.nouvel_id();
            m.missions.insert(mid, Mission { id: mid, proprio: pid, unites: lot, base, cible, retour: false, progres: 0.0, duree });
            m.armees.retain(|_, a| !a.unites.is_empty());
            Ok(format!("Escadre en vol, impact dans {} s.", (duree / regles.vitesse).round()))
        }
        "missile" => {
            let aid = u(cmd, "armee").ok_or("Arsenal manquant.")? as u32;
            let genre = s(cmd, "genre").to_string();
            let cible = u(cmd, "cible").ok_or("Cible manquante.")? as usize;
            if cible >= m.cases.len() {
                return Err("Cible invalide.".into());
            }
            let ud = unite(&genre).filter(|u| u.domaine == DOM_MISSILE).ok_or("Missile inconnu.")?;
            let a = m.armees.get(&aid).filter(|a| a.proprio == pid).ok_or("Arsenal introuvable.")?;
            if *a.unites.get(&genre).unwrap_or(&0) == 0 {
                return Err("Aucun missile de ce type en stock.".into());
            }
            if m.cases[a.case].bat.as_deref() != Some("silo") || m.cases[a.case].proprio != Some(pid) {
                return Err("Les missiles se tirent depuis un silo.".into());
            }
            let d = m.distance(a.case, cible) as f64;
            if d > ud.portee {
                return Err(format!("Cible hors de portée ({} cases).", ud.portee));
            }
            let ok = m.cases[cible].proprio.map(|o| hostile(m, pid, o)).unwrap_or(false)
                || m.armees.values().any(|x| x.case == cible && hostile(m, pid, x.proprio));
            if !ok {
                return Err("La cible doit appartenir à une nation en guerre avec vous.".into());
            }
            let depart = a.case;
            // Arme nucleaire : soit de la matiere fissile brute (uranium enrichi
            // ou plutonium) + des explosifs de mise a feu, soit des ogives
            // fabriquees (ogive nucleaire, bombe H) qui contiennent deja tout.
            let (matiere, explosifs, fissile) = if genre == "missile_nucleaire" && matches!(s(cmd, "fissile"), "ogive" | "ogive_h") {
                let objet = if s(cmd, "fissile") == "ogive_h" { "ogive_h" } else { "ogive_nucleaire" };
                let n = cmd.get("matiere").and_then(|v| v.as_f64()).unwrap_or(1.0).floor();
                if !(1.0..=100_000.0).contains(&n) {
                    return Err("Nombre d'ogives invalide.".into());
                }
                let dispo = fab::qte(&m.pays[&pid].stock, objet);
                if dispo + 1e-9 < n {
                    return Err(format!("Il faut {} × {} (vous en avez {}). Fabriquez-en au complexe industriel.", n, fab::nom_objet(objet), dispo.floor()));
                }
                fab::ajouter(&mut m.pays.get_mut(&pid).unwrap().stock, objet, -n);
                (n, 0.0, s(cmd, "fissile").to_string())
            } else if genre == "missile_nucleaire" {
                let kg = cmd.get("matiere").and_then(|v| v.as_f64()).unwrap_or(20.0);
                if !(5.0..=1_000_000.0).contains(&kg) {
                    return Err("Matière fissile : au moins 5 kg.".into());
                }
                let fissile = if s(cmd, "fissile") == "plutonium" { "plutonium" } else { "uranium" };
                let mini = explosifs_requis(kg);
                let expl = cmd.get("explosifs").and_then(|v| v.as_f64()).unwrap_or(mini).max(mini).min(mini * 2.0).ceil();
                let p = &m.pays[&pid];
                let dispo = if fissile == "plutonium" { fab::qte(&p.stock, "Pu") } else { p.ur_enrichi };
                if dispo + 1e-9 < kg {
                    return Err(format!(
                        "Il faut {} kg de {} (vous en avez {}).",
                        kg, if fissile == "plutonium" { "plutonium" } else { "uranium enrichi" }, dispo.floor()
                    ));
                }
                if fab::qte(&p.stock, "explosifs") + 1e-9 < expl {
                    return Err(format!("Il faut {} explosifs pour la mise à feu (Fabrique niveau 2).", expl));
                }
                let p = m.pays.get_mut(&pid).unwrap();
                if fissile == "plutonium" {
                    fab::ajouter(&mut p.stock, "Pu", -kg);
                } else {
                    p.ur_enrichi -= kg;
                }
                fab::ajouter(&mut p.stock, "explosifs", -expl);
                (kg, expl, fissile.to_string())
            } else {
                (0.0, 0.0, String::new())
            };
            let a = m.armees.get_mut(&aid).unwrap();
            *a.unites.get_mut(&genre).unwrap() -= 1;
            a.unites.retain(|_, n| *n > 0);
            m.armees.retain(|_, a| !a.unites.is_empty());
            let duree = (d.max(1.0) / ud.vitesse * 60.0).max(5.0);
            let mid = m.nouvel_id();
            m.missiles.insert(mid, MissileVol { id: mid, proprio: pid, genre: genre.clone(), depart, cible, progres: 0.0, duree, matiere, explosifs, fissile });
            if let Some(p) = m.pays.get_mut(&pid) {
                p.stats.missiles_lances += 1;
            }
            let nom = m.nom_pays(pid);
            if genre == "missile_nucleaire" {
                m.evenement(None, "nucleaire", format!("ALERTE MONDIALE : lancement nucléaire détecté depuis {} !", nom), Some(cible));
            }
            if let Some(o) = m.cases[cible].proprio {
                m.evenement(Some(o), "alerte", format!("Missile entrant tiré par {} ! Impact dans {} s.", nom, (duree / regles.vitesse).round()), Some(cible));
            }
            Ok(format!("{} lancé, impact dans {} s.", ud.nom, (duree / regles.vitesse).round()))
        }

        // ── Diplomatie ──
        "guerre" => {
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            declarer_guerre(m, pid, cible)
        }
        "proposer" => {
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            let genre = s(cmd, "genre");
            if !matches!(genre, "paix" | "pna" | "alliance") {
                return Err("Proposition inconnue.".into());
            }
            if cible == pid || !m.pays.get(&cible).map(|p| !p.elimine).unwrap_or(false) {
                return Err("Pays invalide.".into());
            }
            let etat = m.relation(pid, cible);
            if genre == "paix" && etat != Etat::Guerre {
                return Err("Vous n'êtes pas en guerre avec ce pays.".into());
            }
            if genre == "pna" && etat != Etat::Paix {
                return Err("Un pacte n'est possible qu'en temps de paix.".into());
            }
            if genre == "alliance" {
                if etat == Etat::Guerre {
                    return Err("Faites d'abord la paix.".into());
                }
                if m.meme_bloc(pid, cible) {
                    return Err("Vous êtes déjà alliés.".into());
                }
                if m.pays[&pid].bloc.is_some() && m.pays[&cible].bloc.is_some() {
                    return Err("Vous êtes chacun dans une alliance : l'un de vous doit d'abord quitter la sienne.".into());
                }
            }
            if m.propositions.iter().any(|x| x.de == pid && x.a == cible && x.genre == genre) {
                return Err("Proposition déjà envoyée.".into());
            }
            m.propositions.push(Proposition { de: pid, a: cible, genre: genre.into(), t: maint });
            let nom = m.nom_pays(pid);
            let quoi = match genre { "paix" => "un traité de paix", "alliance" => "une alliance", _ => "un pacte de non-agression" };
            m.evenement(Some(cible), "diplomatie", format!("{} vous propose {}.", nom, quoi), None);
            Ok("Proposition envoyée.".into())
        }
        "repondre" => {
            let de = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            let genre = s(cmd, "genre").to_string();
            let accepte = cmd.get("accepte").and_then(|x| x.as_bool()).unwrap_or(false);
            let pos = m
                .propositions
                .iter()
                .position(|x| x.de == de && x.a == pid && x.genre == genre)
                .ok_or("Proposition expirée.")?;
            m.propositions.remove(pos);
            let (nom, nom_de) = (m.nom_pays(pid), m.nom_pays(de));
            if !accepte {
                m.evenement(Some(de), "diplomatie", format!("{} a rejeté votre proposition.", nom), None);
                return Ok("Proposition rejetée.".into());
            }
            let cle = Monde::cle_rel(pid, de);
            if genre == "alliance" {
                return allier(m, de, pid);
            }
            if genre == "paix" {
                m.relations.insert(cle, Relation { etat: Etat::Paix, depuis: maint, jusqu: 0 });
                for a in m.armees.values_mut() {
                    if a.proprio == pid || a.proprio == de {
                        a.assaut = None;
                        a.bombarde = None;
                    }
                }
                m.evenement(None, "diplomatie", format!("Paix signée entre {} et {}.", nom, nom_de), None);
            } else {
                let traites = m.pays[&pid].a("dip_traites") || m.pays[&de].a("dip_traites");
                let duree = DUREE_PNA * if traites { 2 } else { 1 };
                m.relations.insert(cle, Relation { etat: Etat::Pna, depuis: maint, jusqu: maint + duree });
                m.evenement(None, "diplomatie", format!("{} et {} signent un pacte de non-agression.", nom, nom_de), None);
            }
            Ok("Accord signé.".into())
        }
        "aide" => {
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            let arr = cmd.get("res").and_then(|x| x.as_array()).ok_or("Montants manquants.")?;
            if cible == pid || !m.pays.get(&cible).map(|p| !p.elimine).unwrap_or(false) {
                return Err("Pays invalide.".into());
            }
            if m.en_guerre(pid, cible) {
                return Err("Impossible d'aider un ennemi.".into());
            }
            let mut v = [0.0; NB_RES];
            for i in 0..NB_RES {
                v[i] = arr.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0).max(0.0).floor();
            }
            if v.iter().sum::<f64>() <= 0.0 {
                return Err("Rien à envoyer.".into());
            }
            let p = &m.pays[&pid];
            if !peut_payer(p, &v) {
                return Err(manque(&v, p));
            }
            payer(m.pays.get_mut(&pid).unwrap(), &v);
            rembourser(m.pays.get_mut(&cible).unwrap(), &v, 0.95);
            let nom = m.nom_pays(pid);
            m.evenement(Some(cible), "diplomatie", format!("{} vous a envoyé une aide ({} unités de ressources).", nom, v.iter().sum::<f64>()), None);
            Ok("Aide envoyée (5 % perdus en transport).".into())
        }
        "espionnage" => {
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            espionner(m, pid, cible, s(cmd, "op"))
        }

        // ── Blocs ──
        "bloc_creer" => {
            let p = &m.pays[&pid];
            if !p.a("dip_alliances") {
                return Err("Technologie requise : Traités d'alliance.".into());
            }
            if p.bloc.is_some() {
                return Err("Quittez d'abord votre bloc actuel.".into());
            }
            if p.influence < 100.0 {
                return Err("Fonder un bloc coûte 100 d'influence.".into());
            }
            let nom = texte_propre(s(cmd, "nom"), 40);
            let sigle = texte_propre(s(cmd, "sigle"), 6).to_uppercase();
            let couleur = s(cmd, "couleur").to_string();
            if nom.chars().count() < 3 || sigle.chars().count() < 2 {
                return Err("Nom (3 car. min.) et sigle (2 à 6 car.) requis.".into());
            }
            if !couleur_valide(&couleur) {
                return Err("Couleur invalide.".into());
            }
            if m.blocs.values().any(|b| b.nom.eq_ignore_ascii_case(&nom) || b.sigle == sigle) {
                return Err("Nom ou sigle déjà pris.".into());
            }
            let id = m.nouvel_id();
            m.blocs.insert(id, Bloc {
                id, nom: nom.clone(), sigle: sigle.clone(), couleur,
                charte: texte_propre(s(cmd, "charte"), 400),
                chef: pid, membres: vec![pid], candidats: vec![], invites: vec![], cree: maint, tresor: 0.0,
            });
            let p = m.pays.get_mut(&pid).unwrap();
            p.influence -= 100.0;
            p.bloc = Some(id);
            let n = m.nom_pays(pid);
            m.evenement(None, "diplomatie", format!("{} fonde un nouveau bloc : {} ({}).", n, nom, sigle), None);
            Ok("Bloc fondé.".into())
        }
        "bloc_postuler" => {
            let bid = u(cmd, "bloc").ok_or("Bloc manquant.")? as u32;
            if m.pays[&pid].bloc.is_some() {
                return Err("Vous êtes déjà dans un bloc.".into());
            }
            let bl = m.blocs.get(&bid).ok_or("Bloc introuvable.")?;
            if bl.membres.iter().any(|&x| m.en_guerre(x, pid)) {
                return Err("Vous êtes en guerre avec un membre de ce bloc.".into());
            }
            if bl.invites.contains(&pid) {
                return rejoindre_bloc(m, pid, bid);
            }
            let chef = bl.chef;
            let bl = m.blocs.get_mut(&bid).unwrap();
            if !bl.candidats.contains(&pid) {
                bl.candidats.push(pid);
            }
            let n = m.nom_pays(pid);
            m.evenement(Some(chef), "diplomatie", format!("{} demande à rejoindre votre bloc.", n), None);
            Ok("Candidature envoyée.".into())
        }
        "bloc_inviter" | "bloc_accepter" | "bloc_refuser" | "bloc_exclure" | "bloc_chef" => {
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            let bid = m.pays[&pid].bloc.ok_or("Vous n'avez pas de bloc.")?;
            if m.blocs[&bid].chef != pid {
                return Err("Réservé au dirigeant du bloc.".into());
            }
            match action {
                "bloc_inviter" => {
                    if m.pays.get(&cible).map(|p| p.bloc.is_some() || p.elimine).unwrap_or(true) {
                        return Err("Ce pays ne peut pas être invité.".into());
                    }
                    let bl = m.blocs.get_mut(&bid).unwrap();
                    if !bl.invites.contains(&cible) {
                        bl.invites.push(cible);
                    }
                    let (n, nb) = (m.nom_pays(pid), m.blocs[&bid].nom.clone());
                    m.evenement(Some(cible), "diplomatie", format!("{} vous invite à rejoindre le bloc {}.", n, nb), None);
                    Ok("Invitation envoyée.".into())
                }
                "bloc_accepter" => {
                    if !m.blocs[&bid].candidats.contains(&cible) {
                        return Err("Aucune candidature de ce pays.".into());
                    }
                    if m.pays.get(&cible).map(|p| p.bloc.is_some()).unwrap_or(true) {
                        m.blocs.get_mut(&bid).unwrap().candidats.retain(|&x| x != cible);
                        return Err("Ce pays a déjà rejoint un autre bloc.".into());
                    }
                    rejoindre_bloc(m, cible, bid)
                }
                "bloc_refuser" => {
                    let bl = m.blocs.get_mut(&bid).unwrap();
                    bl.candidats.retain(|&x| x != cible);
                    bl.invites.retain(|&x| x != cible);
                    Ok("Candidature refusée.".into())
                }
                "bloc_exclure" => {
                    if cible == pid || !m.blocs[&bid].membres.contains(&cible) {
                        return Err("Membre invalide.".into());
                    }
                    quitter_bloc(m, cible);
                    let nb = m.blocs.get(&bid).map(|b| b.nom.clone()).unwrap_or_default();
                    m.evenement(Some(cible), "alerte", format!("Vous avez été exclu du bloc {}.", nb), None);
                    Ok("Membre exclu.".into())
                }
                _ => {
                    if !m.blocs[&bid].membres.contains(&cible) {
                        return Err("Membre invalide.".into());
                    }
                    m.blocs.get_mut(&bid).unwrap().chef = cible;
                    m.evenement(Some(cible), "diplomatie", "Vous dirigez désormais votre bloc.".into(), None);
                    Ok("Direction transmise.".into())
                }
            }
        }
        "bloc_quitter" => {
            if m.pays[&pid].bloc.is_none() {
                return Err("Vous n'avez pas de bloc.".into());
            }
            quitter_bloc(m, pid);
            Ok("Vous avez quitté le bloc.".into())
        }
        "bloc_charte" => {
            let bid = m.pays[&pid].bloc.ok_or("Vous n'avez pas de bloc.")?;
            let bl = m.blocs.get_mut(&bid).unwrap();
            if bl.chef != pid {
                return Err("Réservé au dirigeant du bloc.".into());
            }
            bl.charte = texte_propre(s(cmd, "charte"), 400);
            Ok("Charte mise à jour.".into())
        }
        "bloc_don" => {
            let bid = m.pays[&pid].bloc.ok_or("Vous n'avez pas de bloc.")?;
            let montant = cmd.get("montant").and_then(|x| x.as_f64()).unwrap_or(0.0).floor();
            if montant <= 0.0 || m.pays[&pid].res[CR] < montant {
                return Err("Montant invalide.".into());
            }
            m.pays.get_mut(&pid).unwrap().res[CR] -= montant;
            m.blocs.get_mut(&bid).unwrap().tresor += montant;
            Ok(format!("{} crédits versés au trésor commun.", montant))
        }
        "bloc_verser" => {
            let bid = m.pays[&pid].bloc.ok_or("Vous n'avez pas de bloc.")?;
            let cible = u(cmd, "pays").ok_or("Pays manquant.")? as u32;
            let montant = cmd.get("montant").and_then(|x| x.as_f64()).unwrap_or(0.0).floor();
            let bl = &m.blocs[&bid];
            if bl.chef != pid {
                return Err("Réservé au dirigeant du bloc.".into());
            }
            if !bl.membres.contains(&cible) || montant <= 0.0 || bl.tresor < montant {
                return Err("Versement impossible.".into());
            }
            m.blocs.get_mut(&bid).unwrap().tresor -= montant;
            m.pays.get_mut(&cible).unwrap().res[CR] += montant;
            m.evenement(Some(cible), "diplomatie", format!("Le trésor du bloc vous verse {} crédits.", montant), None);
            Ok("Versement effectué.".into())
        }

        // ── Marche mondial ──
        "marche" if s(cmd, "genre") == "unite" => {
            // Equipement militaire livre cle en main (meme sans la technologie,
            // mais plus cher), sauf l'arme nucleaire.
            let ud = unite(s(cmd, "unite")).ok_or("Unité inconnue.")?;
            if ud.id == "missile_nucleaire" {
                return Err("L'arme nucléaire ne s'achète pas.".into());
            }
            let qte = u(cmd, "qte").unwrap_or(1).clamp(1, 20) as u32;
            let p = &m.pays[&pid];
            let total = prix_unite_marche(p, ud, &m.prix) * qte as f64;
            if p.res[CR] < total {
                return Err(format!("Il faut {} crédits.", total));
            }
            // Livraison : a un batiment capable de l'accueillir, sinon a la
            // capitale pour les troupes terrestres.
            let dest = (0..m.cases.len())
                .find(|&i| m.cases[i].proprio == Some(pid) && m.cases[i].bat.as_deref() == Some(ud.batiment))
                .or(if ud.domaine == DOM_TERRE { Some(p.capitale) } else { None })
                .ok_or(format!("Il faut un(e) {} pour recevoir cette unité.", bat(ud.batiment).map(|d| d.nom.to_lowercase()).unwrap_or_default()))?;
            m.pays.get_mut(&pid).unwrap().res[CR] -= total;
            let mut lot = BTreeMap::new();
            lot.insert(ud.id.to_string(), qte);
            deposer_unites(m, pid, dest, &lot);
            m.evenement(Some(pid), "militaire", format!("{} × {} achetés au marché et livrés.", qte, ud.nom), Some(dest));
            Ok(format!("{} × {} livrés pour {} crédits.", qte, ud.nom, total))
        }
        "marche" if s(cmd, "genre") == "vendre_unite" => {
            // Revente d'unites au repos : 40 % de leur prix d'achat au marche.
            let ud = unite(s(cmd, "unite")).ok_or("Unité inconnue.")?;
            let mut reste = u(cmd, "qte").unwrap_or(1).clamp(1, 500) as u32;
            let voulu = reste;
            let prix_u = (prix_unite_marche(&m.pays[&pid], ud, &m.prix) / if ud.tech.is_empty() || m.pays[&pid].a(ud.tech) { 1.5 } else { 2.5 } * 0.6).floor();
            for a in m.armees.values_mut().filter(|a| a.proprio == pid && a.chemin.is_empty() && a.assaut.is_none()) {
                if reste == 0 {
                    break;
                }
                if let Some(nb) = a.unites.get_mut(ud.id) {
                    let pris = (*nb).min(reste);
                    *nb -= pris;
                    reste -= pris;
                }
                a.unites.retain(|_, n| *n > 0);
            }
            m.armees.retain(|_, a| !a.unites.is_empty());
            let vendues = voulu - reste;
            if vendues == 0 {
                return Err(format!("Aucun(e) {} au repos à vendre.", ud.nom.to_lowercase()));
            }
            let total = prix_u * vendues as f64;
            m.pays.get_mut(&pid).unwrap().res[CR] += total;
            Ok(format!("{} × {} vendus pour {} crédits.", vendues, ud.nom, total))
        }
        "marche" if s(cmd, "genre") == "vendre_service" => {
            let quoi = s(cmd, "service");
            let qte = u(cmd, "qte").unwrap_or(0).clamp(1, 5000) as f64;
            let p = m.pays.get_mut(&pid).unwrap();
            let (dispo, prix_u) = match quoi {
                "recherche" => (p.recherche_stock, PRIX_POINT_RECHERCHE / 2.0),
                "influence" => (p.influence, PRIX_INFLUENCE / 2.0),
                _ => return Err("Service inconnu.".into()),
            };
            if dispo < qte {
                return Err(format!("Vous n'avez que {} points.", dispo.floor()));
            }
            match quoi {
                "recherche" => p.recherche_stock -= qte,
                _ => p.influence -= qte,
            }
            let total = (prix_u * qte).floor();
            p.res[CR] += total;
            Ok(format!("{} points vendus pour {} crédits.", qte, total))
        }
        "marche" if s(cmd, "genre") == "service" => {
            let quoi = s(cmd, "service");
            let qte = u(cmd, "qte").unwrap_or(0).clamp(1, 5000) as f64;
            let (prix_u, nom) = match quoi {
                "recherche" => (PRIX_POINT_RECHERCHE, "points de recherche"),
                "influence" => (PRIX_INFLUENCE, "points d'influence"),
                _ => return Err("Service inconnu.".into()),
            };
            let total = (prix_u * qte).ceil();
            let p = m.pays.get_mut(&pid).unwrap();
            if p.res[CR] < total {
                return Err(format!("Il faut {} crédits.", total));
            }
            p.res[CR] -= total;
            match quoi {
                "recherche" => p.recherche_stock += qte,
                _ => p.influence = (p.influence + qte).min(1000.0),
            }
            Ok(format!("{} {} achetés pour {} crédits.", qte, nom, total))
        }
        "marche" => {
            let r = u(cmd, "res").ok_or("Ressource manquante.")? as usize;
            let qte = cmd.get("qte").and_then(|x| x.as_f64()).unwrap_or(0.0).floor().clamp(0.0, 5000.0);
            if r == CR || r >= NB_RES || qte <= 0.0 {
                return Err("Ordre invalide.".into());
            }
            if RESSOURCES[r].prix_base <= 0.0 {
                return Err(format!("{} ne s'échange pas au marché.", RESSOURCES[r].nom));
            }
            let achat = s(cmd, "sens") == "achat";
            let p = &m.pays[&pid];
            let frais = frais_marche(p);
            let prix = m.prix[r];
            let base = RESSOURCES[r].prix_base;
            if achat {
                let total = (prix * qte * (1.0 + frais)).ceil();
                if p.res[CR] < total {
                    return Err(format!("Il faut {} crédits.", total));
                }
                if p.res[r] + qte > b.stock {
                    return Err("Stockage insuffisant (construisez des entrepôts).".into());
                }
                let p = m.pays.get_mut(&pid).unwrap();
                p.res[CR] -= total;
                p.res[r] += qte;
                m.prix[r] = (prix * (1.0 + 0.05 * qte / 1000.0)).min(base * 4.0);
                Ok(format!("Achat de {} {} pour {} crédits.", qte, RESSOURCES[r].nom.to_lowercase(), total))
            } else {
                if p.res[r] < qte {
                    return Err("Stock insuffisant.".into());
                }
                let bonus = if p.a("eco_mondialisation") { 1.2 } else { 1.0 };
                let total = (prix * qte * (1.0 - frais) * bonus).floor();
                let p = m.pays.get_mut(&pid).unwrap();
                p.res[r] -= qte;
                p.res[CR] += total;
                m.prix[r] = (prix * (1.0 - 0.05 * qte / 1000.0)).max(base * 0.25);
                Ok(format!("Vente de {} {} pour {} crédits.", qte, RESSOURCES[r].nom.to_lowercase(), total))
            }
        }

        // ── Profil ──
        "profil" => {
            let devise = texte_propre(s(cmd, "devise"), 80);
            let couleur = s(cmd, "couleur").to_string();
            let embleme = s(cmd, "embleme").to_string();
            let p = m.pays.get_mut(&pid).unwrap();
            p.devise = devise;
            if couleur_valide(&couleur) {
                p.couleur = couleur;
            }
            if EMBLEMES.contains(&embleme.as_str()) {
                p.embleme = embleme;
            }
            // Force le rafraichissement des frontieres chez tout le monde.
            let cases: Vec<usize> = (0..m.cases.len()).filter(|&i| m.cases[i].proprio == Some(pid)).collect();
            for i in cases {
                m.toucher(i);
            }
            Ok("Profil mis à jour.".into())
        }

        // ── Chat ──
        "chat" => {
            let texte = texte_propre(s(cmd, "texte"), 300);
            if texte.is_empty() {
                return Err("Message vide.".into());
            }
            let canal = if s(cmd, "canal") == "bloc" {
                let bid = m.pays[&pid].bloc.ok_or("Vous n'avez pas de bloc.")?;
                format!("bloc:{}", bid)
            } else {
                "global".to_string()
            };
            let recent = m.chat.iter().rev().take(20).filter(|c| c.auteur == j.nom && maint * 1000 - c.t < 5000).count();
            if recent >= 3 {
                return Err("Doucement : 3 messages max. toutes les 5 secondes.".into());
            }
            m.prochain_msg += 1;
            let p = &m.pays[&pid];
            let msg = MessageChat {
                id: m.prochain_msg,
                canal,
                auteur: j.nom.to_string(),
                pays: p.nom.clone(),
                couleur: p.couleur.clone(),
                texte,
                t: chrono::Utc::now().timestamp_millis(),
            };
            m.chat.push_back(msg);
            while m.chat.len() > 400 {
                m.chat.pop_front();
            }
            Ok(String::new())
        }
        _ => Err("Action inconnue.".into()),
    }
}

fn rejoindre(m: &mut Monde, j: &Joueur, cmd: &Value, regles: &Regles) -> Result<String, String> {
    if pays_du_joueur(m, j.user_id).is_some() {
        return Err("Vous dirigez déjà une nation.".into());
    }
    let nom = texte_propre(s(cmd, "nom"), 28);
    if nom.chars().count() < 3 {
        return Err("Le nom doit faire au moins 3 caractères.".into());
    }
    if m.pays.values().any(|p| p.nom.eq_ignore_ascii_case(&nom)) {
        return Err("Ce nom est déjà pris.".into());
    }
    let couleur = s(cmd, "couleur").to_string();
    if !couleur_valide(&couleur) {
        return Err("Couleur invalide.".into());
    }
    let spe = s(cmd, "spe");
    specialisation(spe).ok_or("Choisissez une spécialisation.")?;
    let embleme = s(cmd, "embleme");
    let embleme = if EMBLEMES.contains(&embleme) { embleme } else { "star" };
    let pid = m.nouvel_id();
    let maint = maintenant();
    m.pays.insert(pid, Pays {
        id: pid,
        user_id: j.user_id,
        joueur: j.nom.to_string(),
        nom: nom.clone(),
        couleur,
        embleme: embleme.into(),
        devise: texte_propre(s(cmd, "devise"), 80),
        spe: spe.into(),
        capitale: 0,
        res: [0.0; NB_RES],
        pop: 0.0,
        influence: 0.0,
        recherche_stock: 0.0,
        techs: vec![],
        recherche: None,
        recherche_prog: 0.0,
        file_recherche: vec![],
        chantiers: vec![],
        productions: vec![],
        protection: 0,
        cree: maint,
        actif: maint,
        stats: Stats::default(),
        bloc: None,
        elimine: false,
        amelio: BTreeMap::new(),
        ur_enrichi: 0.0,
        troupes: 0.0,
        stock: Default::default(),
        fabrications: vec![],
    });
    if let Err(e) = installer_pays(m, pid, regles) {
        m.pays.remove(&pid);
        return Err(e);
    }
    let cap = m.pays[&pid].capitale;
    m.evenement(None, "diplomatie", format!("Une nouvelle nation voit le jour : {}.", nom), Some(cap));
    m.evenement(Some(pid), "construction", format!("Bienvenue, dirigeant de {} ! Votre capitale est fondée.", nom), Some(cap));
    Ok("Nation fondée.".into())
}

fn declarer_guerre(m: &mut Monde, pid: u32, cible: u32) -> Result<String, String> {
    let maint = maintenant();
    if cible == pid {
        return Err("Déclarer la guerre à soi-même ?".into());
    }
    let pc = m.pays.get(&cible).filter(|p| !p.elimine).ok_or("Pays introuvable.")?;
    if m.meme_bloc(pid, cible) {
        return Err("Impossible d'attaquer un membre de votre propre bloc.".into());
    }
    if m.en_guerre(pid, cible) {
        return Err("Vous êtes déjà en guerre.".into());
    }
    if pc.protection > maint {
        return Err(format!(
            "Cette nation est sous protection des nouveaux venus encore {} min.",
            (pc.protection - maint) / 60 + 1
        ));
    }
    if let Some(r) = m.relations.get(&Monde::cle_rel(pid, cible)) {
        if r.etat == Etat::Pna && r.jusqu > maint {
            return Err("Un pacte de non-agression vous lie encore à ce pays.".into());
        }
    }
    if m.pays[&pid].influence < 10.0 {
        return Err("Déclarer une guerre coûte 10 d'influence.".into());
    }
    {
        let p = m.pays.get_mut(&pid).unwrap();
        p.influence -= 10.0;
        p.protection = 0;
    }
    // Article 5 : tous les membres du bloc de la cible entrent en guerre.
    let mut adversaires = vec![cible];
    if let Some(bid) = m.pays[&cible].bloc {
        for &x in &m.blocs[&bid].membres {
            if x != cible && !m.meme_bloc(x, pid) {
                adversaires.push(x);
            }
        }
    }
    for &x in &adversaires {
        m.relations.insert(Monde::cle_rel(pid, x), Relation { etat: Etat::Guerre, depuis: maint, jusqu: 0 });
        m.propositions.retain(|p| !((p.de == pid && p.a == x) || (p.de == x && p.a == pid)));
    }
    let (na, nc) = (m.nom_pays(pid), m.nom_pays(cible));
    m.evenement(None, "guerre", format!("{} déclare la guerre à {} !", na, nc), Some(m.pays[&cible].capitale));
    if adversaires.len() > 1 {
        let bn = m.pays[&cible].bloc.and_then(|b| m.blocs.get(&b)).map(|b| b.nom.clone()).unwrap_or_default();
        m.evenement(None, "guerre", format!("Défense collective : tout le bloc {} entre en guerre contre {}.", bn, na), None);
    }
    for &x in &adversaires {
        m.evenement(Some(x), "alerte", format!("{} vous a déclaré la guerre !", na), None);
    }
    Ok(format!("Guerre déclarée à {}.", nc))
}

/// Alliance acceptee : celui qui n'a pas d'alliance rejoint celle de l'autre,
/// ou une nouvelle alliance est fondee pour les deux (chef : `de`).
fn allier(m: &mut Monde, de: u32, a: u32) -> Result<String, String> {
    match (m.pays[&de].bloc, m.pays[&a].bloc) {
        (Some(b), None) => rejoindre_bloc(m, a, b),
        (None, Some(b)) => rejoindre_bloc(m, de, b),
        (Some(_), Some(_)) => Err("Vous êtes chacun dans une alliance : l'un de vous doit d'abord quitter la sienne.".into()),
        (None, None) => {
            let (n1, n2) = (m.nom_pays(de), m.nom_pays(a));
            let mut nom = format!("Alliance {} – {}", n1, n2).chars().take(40).collect::<String>();
            let mut sigle: String = n1.chars().filter(|c| c.is_alphabetic()).take(2).chain(n2.chars().filter(|c| c.is_alphabetic()).take(2)).collect::<String>().to_uppercase();
            let id = m.nouvel_id();
            if m.blocs.values().any(|b| b.nom == nom || b.sigle == sigle) {
                nom = format!("Alliance {}", id);
                sigle = format!("A{}", id % 10000);
            }
            let couleur = m.pays[&de].couleur.clone();
            m.blocs.insert(id, Bloc {
                id, nom: nom.clone(), sigle, couleur, charte: String::new(),
                chef: de, membres: vec![de, a], candidats: vec![], invites: vec![], cree: maintenant(), tresor: 0.0,
            });
            for p in [de, a] {
                m.pays.get_mut(&p).unwrap().bloc = Some(id);
                for b in m.blocs.values_mut() {
                    b.candidats.retain(|&x| x != p);
                    b.invites.retain(|&x| x != p);
                }
            }
            m.evenement(None, "diplomatie", format!("{} et {} fondent l'{}.", n1, n2, nom), None);
            Ok(format!("Alliance fondée : {}.", nom))
        }
    }
}

fn rejoindre_bloc(m: &mut Monde, pid: u32, bid: u32) -> Result<String, String> {
    let bl = m.blocs.get(&bid).ok_or("Bloc introuvable.")?;
    if bl.membres.len() >= TAILLE_MAX_BLOC {
        return Err(format!("Bloc complet ({} membres max.).", TAILLE_MAX_BLOC));
    }
    if bl.membres.iter().any(|&x| m.en_guerre(x, pid)) {
        return Err("Ce pays est en guerre avec un membre du bloc.".into());
    }
    let bl = m.blocs.get_mut(&bid).unwrap();
    bl.membres.push(pid);
    bl.candidats.retain(|&x| x != pid);
    bl.invites.retain(|&x| x != pid);
    let nb = bl.nom.clone();
    for b in m.blocs.values_mut() {
        b.candidats.retain(|&x| x != pid);
        b.invites.retain(|&x| x != pid);
    }
    m.pays.get_mut(&pid).unwrap().bloc = Some(bid);
    let n = m.nom_pays(pid);
    m.evenement(None, "diplomatie", format!("{} rejoint le bloc {}.", n, nb), None);
    Ok(format!("Bienvenue dans le bloc {}.", nb))
}

fn quitter_bloc(m: &mut Monde, pid: u32) {
    let Some(bid) = m.pays.get(&pid).and_then(|p| p.bloc) else { return };
    if let Some(p) = m.pays.get_mut(&pid) {
        p.bloc = None;
    }
    let Some(bl) = m.blocs.get_mut(&bid) else { return };
    bl.membres.retain(|&x| x != pid);
    if bl.membres.is_empty() {
        let nom = bl.nom.clone();
        m.blocs.remove(&bid);
        m.evenement(None, "diplomatie", format!("Le bloc {} est dissous.", nom), None);
    } else if bl.chef == pid {
        bl.chef = bl.membres[0];
        let chef = bl.chef;
        m.evenement(Some(chef), "diplomatie", "Vous héritez de la direction de votre bloc.".into(), None);
    }
}

fn espionner(m: &mut Monde, pid: u32, cible: u32, op: &str) -> Result<String, String> {
    if !m.pays[&pid].a("dip_espionnage") {
        return Err("Technologie requise : Services secrets.".into());
    }
    if cible == pid || !m.pays.get(&cible).map(|p| !p.elimine).unwrap_or(false) {
        return Err("Cible invalide.".into());
    }
    if m.meme_bloc(pid, cible) {
        return Err("On n'espionne pas ses alliés… pas officiellement.".into());
    }
    let cout = match op {
        "sabotage" => 30.0,
        "vol" => 40.0,
        "destabilisation" => 25.0,
        _ => return Err("Opération inconnue.".into()),
    };
    if m.pays[&pid].influence < cout {
        return Err(format!("Il faut {} d'influence.", cout));
    }
    m.pays.get_mut(&pid).unwrap().influence -= cout;
    let bl = bilans(m);
    let amb = bl.get(&cible).map(|b| b.n("ambassade")).unwrap_or(0.0);
    let chance = (0.65 - 0.06 * amb).max(0.15);
    let mut rng = rand::thread_rng();
    let (na, nc) = (m.nom_pays(pid), m.nom_pays(cible));
    if rng.gen::<f64>() >= chance {
        m.evenement(Some(cible), "alerte", format!("Un réseau d'espions de {} a été démantelé sur votre sol.", na), None);
        return Ok(format!("Échec : vos agents ont été capturés par {}.", nc));
    }
    match op {
        "sabotage" => {
            let cibles: Vec<usize> = (0..m.cases.len())
                .filter(|&i| m.cases[i].proprio == Some(cible) && m.cases[i].bat.is_some() && m.cases[i].bat.as_deref() != Some("capitale"))
                .collect();
            let Some(&i) = cibles.choose(&mut rng) else {
                return Ok("Aucune cible industrielle à saboter.".into());
            };
            let nom_b = m.cases[i].bat.clone().and_then(|b| bat(&b)).map(|d| d.nom).unwrap_or("?");
            reduire_batiment(m, i, 1);
            m.evenement(Some(cible), "alerte", format!("Sabotage ! Votre {} a été endommagé.", nom_b.to_lowercase()), Some(i));
            Ok(format!("Sabotage réussi : {} de {} endommagé.", nom_b, nc))
        }
        "vol" => {
            let c = m.pays.get_mut(&cible).unwrap();
            let vole = (c.recherche_prog * 0.15 + c.recherche_stock * 0.15).floor().max(15.0);
            c.recherche_stock = (c.recherche_stock - c.recherche_stock * 0.15).max(0.0);
            c.recherche_prog = (c.recherche_prog - c.recherche_prog * 0.15).max(0.0);
            m.pays.get_mut(&pid).unwrap().recherche_stock += vole;
            m.evenement(Some(cible), "alerte", "Fuite de données : une partie de vos travaux de recherche a été dérobée.".into(), None);
            Ok(format!("Vol technologique réussi : +{} points de recherche.", vole))
        }
        _ => {
            let c = m.pays.get_mut(&cible).unwrap();
            c.influence = (c.influence - 40.0).max(0.0);
            c.pop *= 0.97;
            m.evenement(Some(cible), "alerte", "Troubles intérieurs : une campagne de déstabilisation frappe le pays.".into(), None);
            Ok(format!("Déstabilisation réussie : {} perd de l'influence.", nc))
        }
    }
}

/// Sert aussi au classement : score global d'un pays.
pub fn scores(p: &Pays, b: &Bilan) -> Value {
    let eco = (b.prod[CR] - b.conso[CR]).max(0.0);
    let techno: f64 = p.techs.iter().filter_map(|t| tech(t)).map(|t| t.cout).sum::<f64>() / 100.0;
    let diplo = p.influence + b.n("ambassade") * 10.0 + if p.bloc.is_some() { 25.0 } else { 0.0 };
    let global = b.puissance * 0.6 + eco * 1.5 + b.cases as f64 * 25.0 + techno * 6.0 + p.pop * 0.4 + diplo;
    json!({
        "global": global.round(),
        "militaire": b.puissance.round(),
        "economie": eco.round(),
        "territoire": b.cases,
        "technologie": p.techs.len(),
        "population": p.pop.round(),
        "diplomatie": diplo.round(),
        "victoires": p.stats.combats_gagnes,
        "destructions": p.stats.unites_detruites.round(),
    })
}

#[cfg(test)]
mod tests_armes {
    use super::*;

    /// Antimatiere : toute la zone redevient neutre, meme chez le tireur, et
    /// le centre devient de la mer (cratere).
    #[test]
    fn antimatiere_prend_le_territoire_et_creuse() {
        let regles = Regles { protection_s: 0, vitesse: 1.0 };
        let mut m = Monde::generer(60, 40, 7);
        crate::bots::assurer(&mut m, 1, &regles, 0.0);
        let pid = *m.pays.keys().next().unwrap();
        let cible = m.pays[&pid].capitale;
        frappe_speciale(&mut m, pid, "bombe_antimatiere", cible);
        assert!(m.rayon(cible, 3).iter().all(|&v| m.cases[v].proprio != Some(pid)), "le tireur perd aussi sa terre");
        assert!(m.rayon(cible, RAYON_CRATERE).iter().all(|&v| m.cases[v].terrain == T_MER), "cratere inonde");
        assert!(m.effets.iter().any(|e| e.genre == "antimatiere" && e.rayon == 3));
    }
}
