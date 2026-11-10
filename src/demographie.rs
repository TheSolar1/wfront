// ══════════════════════════════════════════════════════════════════
// demographie.rs — Habitants, ages, naissances, religions et revoltes
//
// Chaque case de terre a des habitants, meme sans proprietaire : celui
// qui l'annexe les recupere. La population d'une nation est la somme de
// ses cases ; sa pyramide des ages (0 a 99 ans) evolue avec le temps :
// 1 jour reel = 2 ans de jeu.
//
// Carte du monde : la population suit la vraie, mais avec des ecarts
// ecrases (habitants = 3,9 x vraie population ^ 2/3 : France ~650 000,
// Inde ~5 millions). Les religions sont les vraies religions majoritaires,
// region par region pour les pays mixtes.
//
// Une case d'une autre religion que la nation qui la tient (hors de son
// propre pays d'origine) peut se revolter, tres rarement ; avec le temps
// (des semaines) elle finit par adopter la religion de la nation.
// ══════════════════════════════════════════════════════════════════

use crate::defs::*;
use crate::jeu::Bilan;
use crate::monde::*;
use rand::Rng;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

/// Une annee de jeu, en secondes de jeu : un demi-jour reel (1 jour = 2 ans).
pub const UN_AN: f64 = 43_200.0;
/// TVA maximale.
pub const TVA_MAX: f64 = 0.6;

/// Part des actifs prets a travailler selon la TVA : tout le monde jusqu'a
/// 20 %, puis de moins en moins (40 % de TVA : un peu plus de la moitie).
pub fn participation(tva: f64) -> f64 {
    (1.0 - 2.2 * (tva - 0.2).max(0.0)).clamp(0.15, 1.0)
}
pub const NB_AGES: usize = 100;
pub const AGE_ACTIF: usize = 18;
pub const AGE_RETRAITE: usize = 65;
/// Ouvriers par niveau de batiment (sauf les villes, qui logent).
pub const EMPLOIS_PAR_NIVEAU: f64 = 800.0;
/// Prime de natalite maximale (credits par naissance).
pub const PRIME_MAX: f64 = 50.0;
/// Duree de formation d'une recrue sans caserne (s de jeu).
pub const FORMATION_S: f64 = 600.0;
/// Delai pour retablir l'ordre avant que la region ne devienne neutre (s reelles).
pub const DELAI_REVOLTE: i64 = 3 * 86_400;

#[derive(Serialize)]
pub struct ReligionDef {
    pub id: u8,
    pub nom: &'static str,
    pub couleur: &'static str,
}

pub const RELIGIONS: &[ReligionDef] = &[
    ReligionDef { id: 1, nom: "Catholicisme", couleur: "#3b82f6" },
    ReligionDef { id: 2, nom: "Protestantisme", couleur: "#8b5cf6" },
    ReligionDef { id: 3, nom: "Orthodoxie", couleur: "#06b6d4" },
    ReligionDef { id: 4, nom: "Islam sunnite", couleur: "#16a34a" },
    ReligionDef { id: 5, nom: "Islam chiite", couleur: "#0f5132" },
    ReligionDef { id: 6, nom: "Hindouisme", couleur: "#f97316" },
    ReligionDef { id: 7, nom: "Bouddhisme", couleur: "#eab308" },
    ReligionDef { id: 8, nom: "Judaïsme", couleur: "#1e3a8a" },
    ReligionDef { id: 9, nom: "Sans religion", couleur: "#9ca3af" },
    ReligionDef { id: 10, nom: "Religions chinoises", couleur: "#dc2626" },
    ReligionDef { id: 11, nom: "Shintoïsme", couleur: "#ec4899" },
    ReligionDef { id: 12, nom: "Sikhisme", couleur: "#a16207" },
];

pub fn nom_religion(id: u8) -> &'static str {
    RELIGIONS.iter().find(|r| r.id == id).map(|r| r.nom).unwrap_or("aucune")
}

/// Donnees reelles : code -> [population (millions), enfants par femme, religion].
fn donnees() -> &'static HashMap<String, [f64; 3]> {
    static D: std::sync::OnceLock<HashMap<String, [f64; 3]>> = std::sync::OnceLock::new();
    D.get_or_init(|| serde_json::from_str(include_str!("demographie_pays.json")).expect("demographie_pays.json invalide"))
}

/// Habitants dans le jeu pour une vraie population (en millions).
pub fn habitants_jeu(millions: f64) -> f64 {
    3.9 * (millions.max(0.0) * 1e6).powf(2.0 / 3.0)
}

// ── Position reelle d'une case (projection Equal Earth inverse) ─────
const A1: f64 = 1.340264;
const A2: f64 = -0.081106;
const A3: f64 = 0.000893;
const A4: f64 = 0.003796;

fn projeter(lon: f64, lat: f64) -> (f64, f64) {
    let m = 3f64.sqrt() / 2.0;
    let t = (m * lat.to_radians().sin()).asin();
    let (t2, t6) = (t * t, t.powi(6));
    let x = lon.to_radians() * t.cos() / (m * (A1 + 3.0 * A2 * t2 + t6 * (7.0 * A3 + 9.0 * A4 * t2)));
    (x, t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)))
}

/// Longitude et latitude (degres) d'un point normalise de la carte du
/// monde (memes bornes que outils/carte-monde/generer.js).
pub fn lonlat(u: f64, v: f64) -> (f64, f64) {
    const MARGE: f64 = 0.02;
    let m = 3f64.sqrt() / 2.0;
    let xmax = projeter(180.0, 0.0).0;
    let (yn, ys) = (projeter(0.0, 83.0).1, projeter(0.0, -56.0).1);
    let largeur = 2.0 * xmax * (1.0 + 2.0 * MARGE);
    let hauteur = (yn - ys) + 2.0 * MARGE * 2.0 * xmax;
    let x = -xmax * (1.0 + 2.0 * MARGE) + u * largeur;
    let y = yn + MARGE * 2.0 * xmax - v * hauteur;
    let mut t = y;
    for _ in 0..12 {
        let (t2, t6) = (t * t, t.powi(6));
        let f = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y;
        let d = A1 + 3.0 * A2 * t2 + t6 * (7.0 * A3 + 9.0 * A4 * t2);
        t -= f / d;
        if f.abs() < 1e-10 {
            break;
        }
    }
    let (t2, t6) = (t * t, t.powi(6));
    let lon = x * m * (A1 + 3.0 * A2 * t2 + t6 * (7.0 * A3 + 9.0 * A4 * t2)) / t.cos();
    let lat = ((t.sin() / m).clamp(-1.0, 1.0)).asin();
    (lon.to_degrees(), lat.to_degrees())
}

// Religions : 1 catholicisme, 2 protestantisme, 3 orthodoxie, 4 sunnite,
// 5 chiite, 6 hindouisme, 7 bouddhisme, 8 judaisme, 9 sans religion,
// 10 religions chinoises, 11 shintoisme, 12 sikhisme.
/// Religion majoritaire en un point d'un pays (regions mixtes).
pub fn religion_locale(code: &str, lon: f64, lat: f64, defaut: u8) -> u8 {
    let dans = |lo0: f64, lo1: f64, la0: f64, la1: f64| lon >= lo0 && lon <= lo1 && lat >= la0 && lat <= la1;
    match code {
        "NG" => {
            if lat > 9.3 { 4 } else if lon > 6.6 && lat < 7.2 { 1 } else { 2 }
        }
        "IN" => {
            if dans(73.8, 77.0, 29.5, 32.5) { 12 }
            else if lat > 32.4 && lon < 76.2 { 4 }
            else if lat > 32.0 && lon >= 76.2 { 7 }
            else if lon > 91.6 && lat < 26.8 && (lat > 25.0 || lon > 92.5) { 2 }
            else if lon > 88.0 && lon < 89.0 && lat > 27.0 { 7 }
            else { 6 }
        }
        "ET" => {
            if lon > 41.0 || (lat < 8.5 && lon > 39.5) || (lat > 10.5 && lon > 40.0) { 4 }
            else if lon < 37.2 && lat < 8.0 { 2 }
            else { 3 }
        }
        "ER" => {
            if dans(38.4, 40.0, 14.0, 16.2) { 3 } else { 4 }
        }
        "BA" => {
            if lon > 18.9 || (lat > 44.6 && lon > 16.8 && lon < 18.8) { 3 }
            else if lon < 17.8 && lat < 44.0 { 1 }
            else { 4 }
        }
        "LB" => {
            if lat > 33.7 && lat < 34.3 && lon < 35.9 { 1 } else if lat < 33.6 { 5 } else { 4 }
        }
        "IQ" => {
            if lat > 34.5 || lon < 43.0 { 4 } else { 5 }
        }
        "IR" => {
            if (lon < 47.0 && lat > 34.5) || (lon > 59.0 && lat < 31.0) { 4 } else { 5 }
        }
        "SY" => {
            if lon < 36.4 && lat > 34.6 { 5 } else { 4 }
        }
        "SA" => {
            if lon > 49.0 && lat > 25.0 && lat < 27.5 { 5 } else { 4 }
        }
        "YE" => {
            if lat > 15.0 && lon < 45.0 { 5 } else { 4 }
        }
        "AF" => {
            if dans(65.5, 68.5, 33.5, 35.5) { 5 } else { 4 }
        }
        "TJ" => {
            if lon > 71.0 && lat < 39.0 { 5 } else { 4 }
        }
        "LK" => {
            if lat > 8.5 { 6 } else { 7 }
        }
        "MY" => {
            if lon > 109.0 && lon < 115.5 && lat < 5.0 { 2 } else { 4 }
        }
        "ID" => {
            if dans(114.4, 115.8, -9.0, -8.0) { 6 }
            else if lon > 131.0 { 2 }
            else if lon > 119.0 && lon < 125.5 && lat < -8.0 { 1 }
            else if lat > 0.3 && lon > 123.5 && lon < 126.0 { 2 }
            else { 4 }
        }
        "PH" => {
            if lat < 8.0 && lon < 124.3 { 4 } else { 1 }
        }
        "TH" => {
            if lat < 7.0 { 4 } else { 7 }
        }
        "MM" => {
            if lat > 24.0 || (lon < 94.3 && lat > 21.0) { 2 } else { 7 }
        }
        "CN" => {
            if lon < 96.0 && lat > 36.0 { 4 }
            else if lon > 78.0 && lon < 103.0 && lat > 27.0 && lat < 37.0 { 7 }
            else { 10 }
        }
        "RU" => {
            if dans(40.0, 49.0, 41.0, 45.0) { 4 }
            else if dans(48.0, 60.0, 51.5, 56.5) { 4 }
            else if dans(89.0, 99.0, 49.7, 53.0) || dans(42.0, 47.0, 45.0, 48.0) { 7 }
            else { 3 }
        }
        "KZ" => {
            if lat > 51.5 { 3 } else { 4 }
        }
        "UA" => {
            if lon < 26.0 && lat > 48.0 { 1 } else { 3 }
        }
        "LV" => {
            if lon > 26.5 { 1 } else { 2 }
        }
        "DE" => {
            if lon > 10.5 && lat > 50.3 { 9 }
            else if lat < 50.6 || (lon < 8.0 && lat < 52.3) { 1 }
            else { 2 }
        }
        "NL" => {
            if lat < 51.8 { 1 } else { 9 }
        }
        "MK" => {
            if lon < 21.2 { 4 } else { 3 }
        }
        "CY" => {
            if lat > 35.2 { 4 } else { 3 }
        }
        "CA" => {
            if lon > -79.5 && lon < -57.0 && lat > 45.0 && lat < 52.0 { 1 } else { 2 }
        }
        "TD" => {
            if lat < 9.8 { 2 } else { 4 }
        }
        "CI" => {
            if lat > 8.0 { 4 } else { 1 }
        }
        "GH" => {
            if lat > 9.0 { 4 } else { 2 }
        }
        "TG" | "BJ" => {
            if lat > 9.5 { 4 } else { 1 }
        }
        "CM" => {
            if lat > 7.0 { 4 } else { 1 }
        }
        "CF" => {
            if lat > 8.5 { 4 } else { 1 }
        }
        "MZ" => {
            if lat > -17.0 && lon > 38.0 { 4 } else { 1 }
        }
        "TZ" => {
            if lon > 38.5 { 4 } else { 1 }
        }
        "KE" => {
            if lon > 39.0 && lat > -1.0 { 4 } else if lon > 39.3 { 4 } else { 2 }
        }
        _ => defaut,
    }
}

/// Densite relative d'une case selon son terrain.
fn poids_terrain(t: u8) -> f64 {
    match t {
        T_PLAINE => 1.0,
        T_FORET => 0.55,
        T_COLLINE => 0.6,
        T_MONTAGNE => 0.18,
        T_DESERT => 0.06,
        T_TOUNDRA => 0.05,
        _ => 0.3,
    }
}

fn centre(m: &Monde, i: usize) -> (f64, f64) {
    let (x, y) = (i % m.largeur, i / m.largeur);
    (x as f64 + if y % 2 == 1 { 0.5 } else { 0.0 }, y as f64 * 0.866)
}

fn hachage(i: usize, sel: u64) -> u64 {
    let mut h = (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ sel.wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    h ^= h >> 31;
    h = h.wrapping_mul(0x94D0_49BB_1331_11EB);
    h ^ (h >> 29)
}

/// Apres la generation ou le chargement d'un monde : habitants naturels et
/// religion de chaque case ; a la premiere fois, peuple les
/// cases et donne a chaque nation sa pyramide des ages.
pub fn preparer(m: &mut Monde) {
    let n = m.cases.len();
    let mut base = vec![0f32; n];
    for c in m.cases.iter_mut() {
        c.rel = 0;
    }
    if m.monde_reel && m.regions.len() == n {
        let pays = pays_reels();
        let d = donnees();
        let caps: Vec<(f64, f64)> = pays.iter().map(|p| centre(m, m.case_uv(p.capitale[0], p.capitale[1]))).collect();
        let mut vrai = vec![0u8; n];
        let mut poids = vec![0f64; n];
        let mut somme = vec![0f64; pays.len() + 1];
        for i in 0..n {
            if !est_terre(m.cases[i].terrain) {
                continue;
            }
            let mut k = m.pays_au_centre(i);
            if k == 0 || k as usize > pays.len() {
                k = m.region(i);
            }
            if k == 0 || k as usize > pays.len() {
                continue;
            }
            vrai[i] = k;
            let (cx, cy) = caps[k as usize - 1];
            let (x, y) = centre(m, i);
            let dist = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
            let cote = if m.est_cote(i) { 1.25 } else { 1.0 };
            let w = poids_terrain(m.cases[i].terrain) * (1.0 + 2.5 * (-dist / 4.0).exp()) * cote;
            poids[i] = w;
            somme[k as usize] += w;
            let code = pays[k as usize - 1].code.as_str();
            let defaut = d.get(code).map(|x| x[2] as u8).unwrap_or(1);
            let (u, v) = m.uv_case(i);
            let (lon, lat) = lonlat(u, v);
            m.cases[i].rel = religion_locale(code, lon, lat, defaut);
        }
        for i in 0..n {
            let k = vrai[i] as usize;
            if k == 0 || somme[k] <= 0.0 {
                continue;
            }
            let millions = d.get(pays[k - 1].code.as_str()).map(|x| x[0]).unwrap_or(1.0);
            base[i] = (habitants_jeu(millions) * poids[i] / somme[k]) as f32;
        }
    } else {
        // Carte aleatoire : grandes regions religieuses autour de quelques
        // foyers, et environ 8 000 habitants par case de plaine.
        let terres: Vec<usize> = (0..n).filter(|&i| est_terre(m.cases[i].terrain)).collect();
        let choix = [1u8, 2, 3, 4, 5, 6, 7, 10];
        let foyers: Vec<((f64, f64), u8)> = if terres.is_empty() {
            vec![]
        } else {
            (0..10)
                .map(|k| {
                    let i = terres[(hachage(k, m.graine) % terres.len() as u64) as usize];
                    (centre(m, i), choix[(hachage(k + 100, m.graine) % choix.len() as u64) as usize])
                })
                .collect()
        };
        for &i in &terres {
            base[i] = (8000.0 * poids_terrain(m.cases[i].terrain)) as f32;
            let (x, y) = centre(m, i);
            m.cases[i].rel = foyers
                .iter()
                .min_by(|a, b| {
                    let da = (a.0 .0 - x).powi(2) + (a.0 .1 - y).powi(2);
                    let db = (b.0 .0 - x).powi(2) + (b.0 .1 - y).powi(2);
                    da.partial_cmp(&db).unwrap()
                })
                .map(|f| f.1)
                .unwrap_or(1);
        }
    }
    m.hab_base = base;
    let changees: Vec<(usize, u8)> = m.religions_changees.iter().map(|(&i, &r)| (i, r)).collect();
    for (i, r) in changees {
        if i < n {
            m.cases[i].rel = r;
        }
    }
    // Premiere fois (nouveau monde ou ancienne sauvegarde) : on peuple les
    // cases, puis chaque nation recoit sa pyramide des ages.
    if m.cases.iter().all(|c| c.hab == 0.0) {
        for i in 0..n {
            m.cases[i].hab = m.hab_base[i];
        }
    }
    let ids: Vec<u32> = m.pays.values().filter(|p| p.ages.len() != NB_AGES && !p.elimine).map(|p| p.id).collect();
    for pid in ids {
        installer(m, pid);
    }
}

/// Mortalite annuelle a l'age `a` (plus forte dans les pays tres feconds,
/// souvent moins developpes).
pub fn mortalite(a: usize, fec: f64) -> f64 {
    let dev = 1.0 + 0.3 * (fec - 1.6).max(0.0);
    let q = if a == 0 { 0.003 * dev * dev } else { 0.0004 + 0.00003 * (0.095 * a as f64).exp() };
    (q * dev).min(0.6)
}

/// Pyramide des ages stable pour une fecondite donnee, total `total`.
pub fn pyramide(fec: f64, total: f64) -> Vec<f64> {
    let r = (fec.max(0.5) / 2.1).ln() / 28.0;
    let mut v = vec![0.0; NB_AGES];
    let mut survie = 1.0;
    for (a, x) in v.iter_mut().enumerate() {
        *x = survie * (-r * a as f64).exp();
        survie *= 1.0 - mortalite(a, fec);
    }
    let s: f64 = v.iter().sum();
    if s > 0.0 {
        for x in v.iter_mut() {
            *x *= total / s;
        }
    }
    v
}

/// Une nation vient d'etre installee (ou le monde vient d'etre migre) :
/// sa population est celle de ses cases, sa religion celle de sa capitale.
pub fn installer(m: &mut Monde, pid: u32) {
    let total: f64 = m.cases.iter().filter(|c| c.proprio == Some(pid)).map(|c| c.hab as f64).sum();
    let Some(p) = m.pays.get(&pid) else { return };
    let cap = p.capitale.min(m.cases.len().saturating_sub(1));
    let fec = if m.monde_reel && !m.regions.is_empty() {
        let k = if p.pays_reel > 0 { p.pays_reel } else { m.region(cap) };
        pays_reels()
            .get((k as usize).wrapping_sub(1))
            .and_then(|pr| donnees().get(pr.code.as_str()))
            .map(|d| d[1])
            .unwrap_or(2.2)
    } else {
        2.2
    };
    let rel = m.cases.get(cap).map(|c| c.rel).filter(|&r| r > 0).unwrap_or(1);
    let p = m.pays.get_mut(&pid).unwrap();
    p.fecondite = fec;
    p.religion = rel;
    p.ages = pyramide(fec, total);
    p.sync = total;
    p.pop = total / 1000.0;
    p.formation.clear();
    if p.naissances == 0.0 {
        p.naissances = 0.0;
        p.deces = 0.0;
    }
}

/// Habitants entre deux ages (inclus, exclus).
pub fn entre(p: &Pays, a0: usize, a1: usize) -> f64 {
    p.ages.iter().skip(a0).take(a1.saturating_sub(a0)).sum()
}

/// Soldats d'une nation : reserve, offensives, recrues, maintien de l'ordre.
pub fn soldats(m: &Monde, pid: u32) -> (f64, f64) {
    let Some(p) = m.pays.get(&pid) else { return (0.0, 0.0) };
    let formation: f64 = p.formation.iter().map(|l| l.n).sum();
    let attaques: f64 = m.attaques.values().filter(|a| a.de == pid).map(|a| a.troupes.max(0.0)).sum();
    let ordre: f64 = m.revoltes.values().filter(|r| r.pays == pid).map(|r| r.forces).sum();
    (p.troupes + attaques + ordre, formation)
}

/// Bonus de fecondite d'une prime de natalite (credits par naissance).
pub fn bonus_prime(prime: f64) -> f64 {
    0.8 * (1.0 - (-prime.clamp(0.0, PRIME_MAX) / 15.0).exp())
}

/// Duree de formation d'une recrue (s de jeu) : les casernes forment plus vite.
pub fn duree_formation(b: &Bilan) -> f64 {
    FORMATION_S / (1.0 + 0.05 * b.n("caserne")).min(2.5)
}

/// Naissances, deces, vieillissement : toutes les 10 secondes de jeu.
pub fn evoluer(m: &mut Monde, bl: &HashMap<u32, Bilan>, dt: f64) {
    m.demo_acc += dt;
    if m.demo_acc < 10.0 {
        return;
    }
    let dt = m.demo_acc;
    m.demo_acc = 0.0;
    let ans = dt / UN_AN;
    let mut par_pays: HashMap<u32, f64> = HashMap::new();
    for c in &m.cases {
        if let Some(p) = c.proprio {
            *par_pays.entry(p).or_insert(0.0) += c.hab as f64;
        }
    }
    let mut facteurs: HashMap<u32, f64> = HashMap::new();
    for (pid, p) in m.pays.iter_mut() {
        if p.elimine {
            continue;
        }
        let cases = par_pays.get(pid).copied().unwrap_or(0.0);
        // Ce que les autres regles ont retire de `pop` (frappes, accidents,
        // soldats tues) compte en morts ; les cases gagnees ou perdues
        // apportent ou emportent leurs habitants.
        let cible = (cases + (p.pop * 1000.0 - p.sync)).max(0.0);
        let fec = if p.fecondite > 0.0 { p.fecondite } else { 2.1 };
        let actuel: f64 = p.ages.iter().sum();
        if p.ages.len() != NB_AGES || actuel <= 0.0 {
            p.ages = pyramide(fec, cible);
        } else {
            let f = cible / actuel;
            for x in p.ages.iter_mut() {
                *x *= f;
            }
        }
        let b = bl.get(pid);
        // Naissances (campagne de natalite : la prime est versee pour chaque
        // naissance, et fait monter la fecondite).
        let femmes = 0.5 * entre(p, 15, 50);
        // Les hopitaux font naitre plus d'enfants (+10 % par niveau, +80 % au plus).
        let hopitaux = 1.0 + (0.1 * b.map(|b| b.n("hopital")).unwrap_or(0.0)).min(0.8);
        let naturelles = femmes * fec / 35.0 * ans * hopitaux;
        let prime = p.prime_natalite.clamp(0.0, PRIME_MAX);
        let mut naissances = naturelles;
        let mut cout = 0.0;
        if prime > 0.0 {
            let avec = naturelles * (1.0 + bonus_prime(prime));
            let c = avec * prime;
            if p.res[CR] >= c {
                p.res[CR] -= c;
                naissances = avec;
                cout = c;
            }
        }
        // Deces : surpopulation (au-dela de la capacite d'accueil) et soins.
        let cap = b.map(|b| b.pop_cap * 1000.0).unwrap_or(0.0);
        let surpop = if cap > 0.0 && cible > cap { 1.0 + 3.0 * (cible / cap - 1.0) } else { 1.0 };
        let soins = 1.0 / (1.0 + 0.5 * (b.map(|b| b.croissance).unwrap_or(1.0) - 1.0).max(0.0));
        let mut morts = 0.0;
        for a in 0..NB_AGES {
            let d = p.ages[a] * (mortalite(a, fec) * ans * surpop * soins).min(1.0);
            p.ages[a] -= d;
            morts += d;
        }
        for a in (0..NB_AGES - 1).rev() {
            let v = p.ages[a] * ans.min(1.0);
            p.ages[a] -= v;
            p.ages[a + 1] += v;
        }
        p.ages[0] += naissances;
        let total: f64 = p.ages.iter().sum();
        // Moyennes glissantes, par jour reel (= par an de jeu).
        let k = (dt / 600.0).min(1.0);
        let par_jour = |x: f64| if ans > 0.0 { x / ans } else { 0.0 };
        // Premier calcul : directement la bonne valeur (pas de montee depuis 0).
        let k = if p.naissances == 0.0 && p.deces == 0.0 { 1.0 } else { k };
        p.naissances += (par_jour(naissances) - p.naissances) * k;
        p.deces += (par_jour(morts) - p.deces) * k;
        p.cout_natalite += (par_jour(cout) - p.cout_natalite) * k;
        p.sync = total;
        p.pop = total / 1000.0;
        facteurs.insert(*pid, if cases > 0.0 { total / cases } else { 1.0 });
    }
    for c in m.cases.iter_mut() {
        if let Some(p) = c.proprio {
            if let Some(f) = facteurs.get(&p) {
                c.hab = (c.hab as f64 * f).max(0.0) as f32;
            }
        }
    }
    historique(m, bl);
}

/// Un point d'historique toutes les 2 heures (400 points : un mois).
fn historique(m: &mut Monde, bl: &HashMap<u32, Bilan>) {
    let maint = chrono::Utc::now().timestamp();
    let ids: Vec<u32> = m.pays.values().filter(|p| !p.elimine).map(|p| p.id).collect();
    for pid in ids {
        let dernier = m.histos.get(&pid).and_then(|h| h.last()).map(|x| x[0] as i64).unwrap_or(0);
        if maint - dernier < 7200 {
            continue;
        }
        let (sold, form) = soldats(m, pid);
        let p = &m.pays[&pid];
        let b = bl.get(&pid).cloned().unwrap_or_default();
        let arr = |x: f64, k: f64| (x * k).round() / k;
        let point = vec![
            maint as f64, p.sync.round(), entre(p, AGE_ACTIF, AGE_RETRAITE).round(), (sold + form).round(), p.naissances.round(), p.deces.round(),
            arr(b.chomage * 100.0, 10.0), arr(b.tva * 100.0, 1.0), arr(b.recettes_tva, 10.0), p.res[CR].round(), arr(b.prod[CR] - b.conso[CR], 10.0),
        ];
        let h = m.histos.entry(pid).or_default();
        h.push(point);
        if h.len() > 400 {
            let trop = h.len() - 400;
            h.drain(..trop);
        }
    }
    let vivants: HashSet<u32> = m.pays.keys().copied().collect();
    m.histos.retain(|k, _| vivants.contains(k));
}

// ══════════════════════════════════════════════════════════════════
// Religions : occupations, conversions, revoltes
// ══════════════════════════════════════════════════════════════════

/// Une nation vient de prendre la case `i` a une autre nation.
pub fn case_conquise(m: &mut Monde, pid: u32, i: usize) {
    let rel = m.pays.get(&pid).map(|p| p.religion).unwrap_or(0);
    let c = &m.cases[i];
    if rel == 0 || c.rel == 0 || c.rel == rel || origine(m, pid, i) {
        m.occupations.remove(&i);
    } else {
        m.occupations.insert(i, Occupation { proprio: pid, depuis: chrono::Utc::now().timestamp(), conquise: true });
    }
    m.cases[i].revolte = false;
}

/// La case fait-elle partie du pays d'origine de la nation (carte du monde) ?
fn origine(m: &Monde, pid: u32, i: usize) -> bool {
    m.monde_reel && m.pays.get(&pid).map(|p| p.pays_reel > 0 && m.region(i) == p.pays_reel).unwrap_or(false)
}

/// Duree avant qu'une case n'adopte la religion de la nation (s reelles) :
/// 50 a 80 jours.
fn duree_conversion(i: usize) -> i64 {
    (50 + (hachage(i, 7) % 31) as i64) * 86_400
}

/// Revoltes par case et par seconde : conquise sur une autre nation (une
/// tous les ~2000 jours par case), terre neutre annexee (dix fois moins).
const TAUX_CONQUISE: f64 = 1.0 / (2000.0 * 86_400.0);
const TAUX_NEUTRE: f64 = 1.0 / (20_000.0 * 86_400.0);

/// Suivi des cases d'une autre religion (toutes les minutes) et combats
/// du maintien de l'ordre (a chaque tick).
pub fn religions(m: &mut Monde, dt: f64, rng: &mut impl Rng) {
    m.occ_acc += dt;
    if m.occ_acc >= 60.0 {
        let pas = m.occ_acc;
        m.occ_acc = 0.0;
        occupations(m, pas, rng);
    }
    maintien_ordre(m, dt);
}

/// Niveaux de commissariats par nation.
fn polices(m: &Monde) -> HashMap<u32, f64> {
    let mut n = HashMap::new();
    for c in &m.cases {
        if let (Some(p), Some("commissariat")) = (c.proprio, c.bat.as_deref()) {
            *n.entry(p).or_insert(0.0) += c.niv as f64;
        }
    }
    n
}

fn occupations(m: &mut Monde, pas: f64, rng: &mut impl Rng) {
    let maint = chrono::Utc::now().timestamp();
    let police = polices(m);
    let mut departs: Vec<(u32, usize)> = Vec::new();
    let mut deja: HashSet<u32> = m.revoltes.values().map(|r| r.pays).collect();
    let mut conversions: Vec<(usize, u8)> = Vec::new();
    for i in 0..m.cases.len() {
        let c = &m.cases[i];
        let Some(pid) = c.proprio else {
            if !m.occupations.is_empty() {
                m.occupations.remove(&i);
            }
            continue;
        };
        let Some(p) = m.pays.get(&pid) else { continue };
        if p.religion == 0 || c.rel == 0 || c.rel == p.religion || origine(m, pid, i) {
            m.occupations.remove(&i);
            continue;
        }
        let o = match m.occupations.get(&i) {
            Some(o) if o.proprio == pid => o.clone(),
            _ => {
                let o = Occupation { proprio: pid, depuis: maint, conquise: false };
                m.occupations.insert(i, o.clone());
                o
            }
        };
        let tenue = maint - o.depuis;
        if tenue > duree_conversion(i) {
            conversions.push((i, p.religion));
            continue;
        }
        if c.revolte || tenue < 12 * 3600 || p.protection > maint || deja.contains(&pid) {
            continue;
        }
        // Chaque niveau de commissariat : -15 % de risque (jusqu'a -90 %).
        let ordre = (1.0 - 0.15 * police.get(&pid).copied().unwrap_or(0.0)).max(0.1);
        let taux = if o.conquise { TAUX_CONQUISE } else { TAUX_NEUTRE } * ordre;
        if rng.gen::<f64>() < taux * pas {
            departs.push((pid, i));
            deja.insert(pid);
        }
    }
    for (i, rel) in conversions {
        m.cases[i].rel = rel;
        m.religions_changees.insert(i, rel);
        m.occupations.remove(&i);
        m.toucher(i);
    }
    for (pid, i) in departs {
        demarrer_revolte(m, pid, i);
    }
}

/// Une region d'une autre religion se souleve autour de la case `i`.
pub fn demarrer_revolte(m: &mut Monde, pid: u32, i: usize) {
    let rel = m.cases[i].rel;
    let mut zone = vec![i];
    let mut vus: HashSet<usize> = HashSet::from([i]);
    let mut file = VecDeque::from([i]);
    while let Some(k) = file.pop_front() {
        for v in m.voisins(k) {
            if zone.len() >= 20 || !vus.insert(v) {
                continue;
            }
            let c = &m.cases[v];
            if c.proprio == Some(pid) && c.rel == rel && !c.revolte && m.distance(v, i) <= 4 {
                zone.push(v);
                file.push_back(v);
            }
        }
    }
    let hab: f64 = zone.iter().map(|&k| m.cases[k].hab as f64).sum();
    // La police affaiblit les revoltes (-5 % de rebelles par niveau, -50 % au plus).
    let police = polices(m).get(&pid).copied().unwrap_or(0.0);
    let rebelles = (hab * 0.06 * (1.0 - 0.05 * police).max(0.5)).max(50.0).round();
    for &k in &zone {
        m.cases[k].revolte = true;
        m.toucher(k);
    }
    let maint = chrono::Utc::now().timestamp();
    let id = m.nouvel_id();
    m.revoltes.insert(id, Revolte { id, pays: pid, cases: zone.clone(), religion: rel, rebelles, debut: maint, limite: maint + DELAI_REVOLTE, forces: 0.0, morts_rebelles: 0.0, morts_soldats: 0.0 });
    let nom = m.nom_pays(pid);
    m.evenement(
        Some(pid),
        "alerte",
        format!(
            "Révolte ({}) : {} rebelles se soulèvent sur {} provinces. Rétablissez l'ordre dans les 3 jours (Population > Révoltes), sinon la région deviendra neutre.",
            nom_religion(rel).to_lowercase(),
            rebelles,
            zone.len()
        ),
        Some(i),
    );
    m.evenement(None, "guerre", format!("Une révolte éclate en {}.", nom), Some(i));
}

/// Envoie des troupes retablir l'ordre dans une revolte.
pub fn reprimer(m: &mut Monde, pid: u32, id: u32, troupes: f64) -> Result<String, String> {
    let r = m.revoltes.get(&id).filter(|r| r.pays == pid).ok_or("Révolte introuvable.")?;
    let _ = r;
    let p = m.pays.get_mut(&pid).ok_or("Pays introuvable.")?;
    let n = troupes.floor().min(p.troupes.floor());
    if n < 10.0 {
        return Err("Pas assez de troupes disponibles (au moins 10).".into());
    }
    p.troupes -= n;
    m.revoltes.get_mut(&id).unwrap().forces += n;
    Ok(format!("{} soldats partent rétablir l'ordre.", n))
}

/// Combats du maintien de l'ordre et fin des revoltes.
fn maintien_ordre(m: &mut Monde, dt: f64) {
    if m.revoltes.is_empty() {
        return;
    }
    let maint = chrono::Utc::now().timestamp();
    let police = polices(m);
    let ids: Vec<u32> = m.revoltes.keys().copied().collect();
    for id in ids {
        let mut r = m.revoltes.remove(&id).unwrap();
        // Cases perdues entre-temps (conquises, rendues...).
        let (gardees, perdues): (Vec<usize>, Vec<usize>) = r.cases.iter().partition(|&&k| m.cases[k].proprio == Some(r.pays));
        for k in perdues {
            m.cases[k].revolte = false;
        }
        r.cases = gardees;
        let vivant = m.pays.get(&r.pays).map(|p| !p.elimine).unwrap_or(false);
        if r.cases.is_empty() || !vivant {
            if let Some(p) = m.pays.get_mut(&r.pays) {
                p.troupes += r.forces;
            }
            continue;
        }
        // Combat : les rebelles se battent chez eux (+30 %).
        if r.forces > 0.0 && r.rebelles > 0.0 {
            const K: f64 = 0.004;
            // La police aide les soldats (+10 % par niveau, +100 % au plus).
            let aide = 1.0 + (0.1 * police.get(&r.pays).copied().unwrap_or(0.0)).min(1.0);
            let dr = (K * r.forces * aide * dt).min(r.rebelles);
            let df = (K * 1.3 * r.rebelles * dt).min(r.forces);
            r.rebelles -= dr;
            r.forces -= df;
            r.morts_rebelles += dr;
            r.morts_soldats += df;
            let hab: f64 = r.cases.iter().map(|&k| m.cases[k].hab as f64).sum();
            if hab > 0.0 {
                let f = (1.0 - dr / hab).max(0.0);
                for &k in &r.cases {
                    m.cases[k].hab = (m.cases[k].hab as f64 * f) as f32;
                }
            }
            if let Some(p) = m.pays.get_mut(&r.pays) {
                p.pop = (p.pop - df / 1000.0).max(0.0);
            }
            if r.rebelles < 1.0 {
                for &k in &r.cases {
                    m.cases[k].revolte = false;
                    m.toucher(k);
                }
                let maint_ordre = format!(
                    "Ordre rétabli : la révolte est matée ({} rebelles et {} soldats tués).",
                    r.morts_rebelles.round(),
                    r.morts_soldats.round()
                );
                if let Some(p) = m.pays.get_mut(&r.pays) {
                    p.troupes += r.forces;
                }
                let c0 = r.cases[0];
                m.evenement(Some(r.pays), "victoire", maint_ordre, Some(c0));
                continue;
            }
            if r.forces < 1.0 {
                r.forces = 0.0;
                m.evenement(Some(r.pays), "alerte", format!("Vos troupes sont repoussées par les rebelles ({} restants). Envoyez des renforts.", r.rebelles.round()), r.cases.first().copied());
            }
        }
        // Delai depasse : la region devient neutre (et annexable).
        if maint > r.limite {
            for &k in &r.cases {
                m.cases[k].proprio = None;
                m.cases[k].revolte = false;
                m.occupations.remove(&k);
                m.toucher(k);
            }
            if let Some(p) = m.pays.get_mut(&r.pays) {
                p.troupes += r.forces;
            }
            let nom = m.nom_pays(r.pays);
            let c0 = r.cases[0];
            m.evenement(Some(r.pays), "alerte", format!("Les rebelles l'emportent : {} provinces deviennent neutres.", r.cases.len()), Some(c0));
            m.evenement(None, "guerre", format!("Des rebelles prennent leur indépendance en {} : la région devient neutre.", nom), Some(c0));
            continue;
        }
        m.revoltes.insert(id, r);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn population_ecrasee_comme_demande() {
        let fr = habitants_jeu(68.4);
        let ind = habitants_jeu(1450.0);
        assert!(fr > 600_000.0 && fr < 700_000.0, "France {}", fr);
        assert!(ind > 4_500_000.0 && ind < 5_500_000.0, "Inde {}", ind);
    }

    #[test]
    fn projection_inverse() {
        // Paris et Sydney : aller-retour par la projection.
        for (lon, lat) in [(2.35, 48.85), (151.2, -33.87), (-74.0, 40.7)] {
            let (x, y) = projeter(lon, lat);
            let xmax = projeter(180.0, 0.0).0;
            let (yn, ys) = (projeter(0.0, 83.0).1, projeter(0.0, -56.0).1);
            let largeur = 2.0 * xmax * 1.04;
            let hauteur = (yn - ys) + 0.04 * 2.0 * xmax;
            let u = (x + xmax * 1.04) / largeur;
            let v = (yn + 0.04 * xmax - y) / hauteur;
            let (lo, la) = lonlat(u, v);
            assert!((lo - lon).abs() < 1e-6 && (la - lat).abs() < 1e-6, "{} {} -> {} {}", lon, lat, lo, la);
        }
    }

    #[test]
    fn pyramides_jeune_et_vieille() {
        let jeune = pyramide(6.0, 1000.0);
        let vieille = pyramide(1.2, 1000.0);
        let enfants = |v: &Vec<f64>| v[..15].iter().sum::<f64>();
        assert!(enfants(&jeune) > 400.0, "Niger : beaucoup d'enfants ({})", enfants(&jeune));
        assert!(enfants(&vieille) < 180.0, "Japon : peu d'enfants ({})", enfants(&vieille));
        assert!((jeune.iter().sum::<f64>() - 1000.0).abs() < 1e-6);
    }

    #[test]
    fn religions_regionales() {
        assert_eq!(religion_locale("NG", 8.5, 12.0, 2), 4, "nord du Nigeria musulman");
        assert_eq!(religion_locale("NG", 3.4, 6.5, 2), 2, "Lagos chretienne");
        assert_eq!(religion_locale("IN", 75.8, 31.0, 6), 12, "Pendjab sikh");
        assert_eq!(religion_locale("IN", 77.2, 28.6, 6), 6, "Delhi hindoue");
        assert_eq!(religion_locale("FR", 2.3, 48.8, 1), 1);
    }
}
