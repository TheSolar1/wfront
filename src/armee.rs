// ══════════════════════════════════════════════════════════════════
// armee.rs — Une seule armee : les soldats, et leur materiel
//
// Les soldats (habitants formes a la caserne) sont la seule armee : ils
// annexent et attaquent par clic droit (front.rs). Chars, artillerie,
// avions, navires et missiles sont du materiel national, produit dans
// les batiments militaires ou achete au marche. Le materiel a besoin d'un
// equipage pris parmi les soldats ; equipe, il multiplie la force des
// soldats en attaque et en defense. Les avions font des raids, les navires
// allongent la portee des debarquements, les missiles partent d'un silo
// ou d'un bombardier.
// ══════════════════════════════════════════════════════════════════

use crate::defs::*;
use crate::monde::*;
use std::collections::BTreeMap;

/// Soldats necessaires pour servir une unite de materiel.
pub fn equipage(id: &str) -> f64 {
    match id {
        "infanterie" => 10.0,
        "forces_speciales" => 5.0,
        "exosoldat" => 2.0,
        "androide" => 0.0,
        "blinde_leger" | "char" | "dca_mobile" | "bombardier" => 4.0,
        "artillerie" => 6.0,
        "chasseur" | "chasseur_furtif" => 1.0,
        "helicoptere" => 2.0,
        "drone" => 0.0,
        "fregate" | "sous_marin" => 40.0,
        "destroyer" => 80.0,
        "porte_avions" => 300.0,
        _ => 0.0,
    }
}

#[derive(Default, Clone, Debug)]
pub struct Forces {
    /// Equipage requis par tout le materiel.
    pub equipage: f64,
    /// Part du materiel qui a son equipage (0 a 1).
    pub equipe: f64,
    /// Multiplicateurs de force des soldats (1 = sans materiel, 3 au plus).
    pub attaque: f64,
    pub defense: f64,
    /// Navires (portee des debarquements).
    pub navires: u32,
}

/// Force de la nation : materiel equipe rapporte au nombre de soldats.
pub fn forces(m: &Monde, pid: u32) -> Forces {
    let Some(p) = m.pays.get(&pid) else { return Forces::default() };
    let (soldats, _) = crate::demographie::soldats(m, pid);
    let mut f = Forces::default();
    let (mut att, mut def) = (0.0, 0.0);
    for (t, &n) in &p.materiel {
        let Some(u) = unite(t) else { continue };
        if u.domaine == DOM_MISSILE {
            continue;
        }
        f.equipage += equipage(t) * n as f64;
        att += u.att_sol * n as f64;
        def += u.defense * n as f64;
        if u.domaine == DOM_MER {
            f.navires += n;
        }
    }
    f.equipe = if f.equipage > 0.0 { (soldats / f.equipage).min(1.0) } else { 1.0 };
    let base = soldats.max(100.0);
    f.attaque = 1.0 + (att * f.equipe / base).min(2.0);
    f.defense = 1.0 + (def * f.equipe / base).min(2.0);
    f
}

/// Portee supplementaire des debarquements grace a la flotte (2 cases par
/// navire, 30 au plus).
pub fn bonus_naval(m: &Monde, pid: u32) -> i64 {
    (forces(m, pid).navires as i64 * 2).min(30)
}

/// Ajoute du materiel au stock national.
pub fn ajouter(p: &mut Pays, lot: &BTreeMap<String, u32>) {
    for (t, n) in lot {
        *p.materiel.entry(t.clone()).or_insert(0) += *n;
    }
}

/// Retire du materiel (rend false s'il n'y en a pas assez).
pub fn retirer(p: &mut Pays, t: &str, n: u32) -> bool {
    let dispo = p.materiel.get(t).copied().unwrap_or(0);
    if dispo < n {
        return false;
    }
    if dispo == n {
        p.materiel.remove(t);
    } else {
        p.materiel.insert(t.to_string(), dispo - n);
    }
    true
}

/// Case possedee la plus proche de `cible` portant le batiment `bat`.
pub fn base_proche(m: &Monde, pid: u32, bat: &str, cible: usize) -> Option<(usize, i64)> {
    (0..m.cases.len())
        .filter(|&i| m.cases[i].proprio == Some(pid) && m.cases[i].bat.as_deref() == Some(bat) && m.cases[i].irradiee <= m.temps)
        .map(|i| (i, m.distance(i, cible)))
        .min_by_key(|&(_, d)| d)
}
