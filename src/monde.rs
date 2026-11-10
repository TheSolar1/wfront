// ══════════════════════════════════════════════════════════════════
// monde.rs — Etat du monde (serialise tel quel dans data/monde.json)
// Grille hexagonale en coordonnees "odd-r" : les lignes impaires sont
// decalees d'une demi-case vers la droite. Case = index y * largeur + x.
// ══════════════════════════════════════════════════════════════════

use crate::defs::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Case {
    pub terrain: u8,
    pub depot: u8,
    pub proprio: Option<u32>,
    pub bat: Option<String>,
    pub niv: u8,
    /// Temps de jeu (s) jusqu'auquel la case est irradiee.
    pub irradiee: f64,
    /// Degats cumules par les bombardements (300 = -1 niveau).
    pub degats: f64,
    /// Numero de revision : envoye aux clients quand il change.
    pub rev: u64,
    /// Habitants de la case (demographie.rs), meme sans proprietaire.
    #[serde(default, skip_serializing_if = "zero_f32")]
    pub hab: f32,
    /// Religion de la case (RELIGIONS, 0 = aucune). Recalculee au
    /// chargement (+ conversions de Monde::religions_changees).
    #[serde(skip)]
    pub rel: u8,
    /// Case en revolte (ne produit plus rien).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub revolte: bool,
}

fn zero_f32(v: &f32) -> bool {
    *v == 0.0
}

fn vrai() -> bool {
    true
}

/// Recrues en formation : `n` soldats prets au temps de jeu `fin`.
#[derive(Serialize, Deserialize, Clone)]
pub struct Lot {
    pub n: f64,
    pub fin: f64,
    pub total: f64,
}

/// Case tenue par une nation d'une autre religion (demographie.rs).
#[derive(Serialize, Deserialize, Clone)]
pub struct Occupation {
    pub proprio: u32,
    /// Horodatage unix de la prise.
    pub depuis: i64,
    /// Prise a une autre nation (sinon : terre neutre annexee).
    pub conquise: bool,
}

/// Revolte d'une region d'une autre religion.
#[derive(Serialize, Deserialize, Clone)]
pub struct Revolte {
    pub id: u32,
    pub pays: u32,
    pub cases: Vec<usize>,
    pub religion: u8,
    pub rebelles: f64,
    pub debut: i64,
    /// Sans maintien de l'ordre gagne avant cette date, la region devient neutre.
    pub limite: i64,
    /// Troupes envoyees pour retablir l'ordre.
    pub forces: f64,
    #[serde(default)]
    pub morts_rebelles: f64,
    #[serde(default)]
    pub morts_soldats: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Chantier {
    pub id: u32,
    pub case: usize,
    /// Batiment vise, ou "annexion".
    pub bat: String,
    pub niv: u8,
    pub reste: f64,
    pub total: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Production {
    pub id: u32,
    pub case: usize,
    pub unite: String,
    pub qte: u32,
    pub reste: f64,
    pub total: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Stats {
    pub combats_gagnes: u32,
    pub combats_perdus: u32,
    pub unites_detruites: f64,
    pub unites_perdues: f64,
    pub cases_conquises: u32,
    pub missiles_lances: u32,
    pub frappes_nucleaires: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Pays {
    pub id: u32,
    pub user_id: i64,
    pub joueur: String,
    pub nom: String,
    pub couleur: String,
    pub embleme: String,
    pub devise: String,
    pub spe: String,
    pub capitale: usize,
    pub res: Res,
    /// Population en milliers d'habitants.
    pub pop: f64,
    pub influence: f64,
    pub recherche_stock: f64,
    pub techs: Vec<String>,
    pub recherche: Option<String>,
    pub recherche_prog: f64,
    pub file_recherche: Vec<String>,
    pub chantiers: Vec<Chantier>,
    pub productions: Vec<Production>,
    /// Horodatage unix (s) de fin de protection des nouveaux joueurs.
    pub protection: i64,
    pub cree: i64,
    pub actif: i64,
    pub stats: Stats,
    pub bloc: Option<u32>,
    pub elimine: bool,
    /// Niveau de chaque amelioration (defs::AMELIORATIONS).
    #[serde(default)]
    pub amelio: BTreeMap<String, u8>,
    /// Stock d'uranium enrichi (centre d'enrichissement -> centrales).
    #[serde(default)]
    pub ur_enrichi: f64,
    /// Troupes disponibles (facon OpenFront) : on en envoie une part pour
    /// s'etendre sur les terres neutres ou attaquer un ennemi.
    #[serde(default)]
    pub troupes: f64,
    /// Minerais, elements et produits fabriques (fabrication.rs).
    #[serde(default)]
    pub stock: crate::fabrication::Stock,
    #[serde(default)]
    pub fabrications: Vec<crate::fabrication::Fabrication>,
    /// Carte du monde : index du vrai pays dirige (pays_reels(), 0 = aucun).
    #[serde(default)]
    pub pays_reel: u8,
    // ── Demographie (demographie.rs) ──
    /// Habitants par age (0 a 99 ans).
    #[serde(default)]
    pub ages: Vec<f64>,
    /// Population (habitants) au dernier calcul demographique : ce que les
    /// autres regles retirent de `pop` entre deux calculs compte en morts.
    #[serde(default)]
    pub sync: f64,
    /// Enfants par femme (vraie valeur du pays).
    #[serde(default)]
    pub fecondite: f64,
    /// Religion d'Etat (RELIGIONS).
    #[serde(default)]
    pub religion: u8,
    /// Campagne de natalite : credits verses par naissance.
    #[serde(default)]
    pub prime_natalite: f64,
    /// Naissances et deces par jour (moyennes glissantes).
    #[serde(default)]
    pub naissances: f64,
    #[serde(default)]
    pub deces: f64,
    /// Cout de la campagne de natalite par jour (moyenne glissante).
    #[serde(default)]
    pub cout_natalite: f64,
    /// Recrutement automatique (parmi les sans-emploi).
    #[serde(default = "vrai")]
    pub recrut_auto: bool,
    #[serde(default)]
    pub formation: Vec<Lot>,
}

impl Pays {
    pub fn a(&self, tech: &str) -> bool {
        self.techs.iter().any(|t| t == tech)
    }
    /// Niveau d'une amelioration (0 si jamais recherchee).
    pub fn niv(&self, id: &str) -> f64 {
        *self.amelio.get(id).unwrap_or(&0) as f64
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Armee {
    pub id: u32,
    pub proprio: u32,
    pub case: usize,
    pub unites: BTreeMap<String, u32>,
    /// Degats accumules par type, en attente de faire tomber une unite.
    pub blessures: BTreeMap<String, f64>,
    pub chemin: Vec<usize>,
    pub progres: f64,
    pub bombarde: Option<usize>,
    /// Case attaquee (l'armee reste sur place tant que le combat dure).
    pub assaut: Option<usize>,
    pub nom: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Mission {
    pub id: u32,
    pub proprio: u32,
    pub unites: BTreeMap<String, u32>,
    pub base: usize,
    pub cible: usize,
    pub retour: bool,
    pub progres: f64,
    pub duree: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MissileVol {
    pub id: u32,
    pub proprio: u32,
    pub genre: String,
    pub depart: usize,
    pub cible: usize,
    pub progres: f64,
    pub duree: f64,
    /// Arme nucleaire : kg de matiere fissile, explosifs, « uranium » ou « plutonium ».
    #[serde(default)]
    pub matiere: f64,
    #[serde(default)]
    pub explosifs: f64,
    #[serde(default)]
    pub fissile: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub enum Etat {
    Paix,
    Guerre,
    Pna,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Relation {
    pub etat: Etat,
    pub depuis: i64,
    /// Fin du pacte de non-agression (unix s).
    pub jusqu: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Proposition {
    pub de: u32,
    pub a: u32,
    pub genre: String,
    pub t: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Bloc {
    pub id: u32,
    pub nom: String,
    pub sigle: String,
    pub couleur: String,
    pub charte: String,
    pub chef: u32,
    pub membres: Vec<u32>,
    pub candidats: Vec<u32>,
    pub invites: Vec<u32>,
    pub cree: i64,
    pub tresor: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Evenement {
    pub t: i64,
    /// None = actualite mondiale, visible par tous.
    pub pays: Option<u32>,
    pub genre: String,
    pub texte: String,
    pub case: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MessageChat {
    pub id: u64,
    pub canal: String,
    pub auteur: String,
    pub pays: String,
    pub couleur: String,
    pub texte: String,
    pub t: i64,
}

/// Offensive facon OpenFront : des troupes avancent case par case dans le
/// territoire vise (neutre ou ennemi), en commencant par les cases les plus
/// proches de celle qui a ete cliquee.
#[derive(Serialize, Deserialize, Clone)]
pub struct Attaque {
    pub id: u32,
    pub de: u32,
    /// None = terres neutres.
    pub cible: Option<u32>,
    pub troupes: f64,
    /// Case cliquee : le front avance vers elle.
    pub vise: usize,
    /// Cases prises par cette offensive.
    pub prises: u32,
    /// Fraction de case deja gagnee.
    pub progres: f64,
    /// Debarquement : case cotiere visee et secondes de traversee restantes.
    #[serde(default)]
    pub bateau: Option<(usize, f64)>,
}

/// Nuage radioactif pousse par le vent apres un accident nucleaire.
#[derive(Serialize, Deserialize, Clone)]
pub struct Nuage {
    pub id: u32,
    pub case: usize,
    /// Direction du vent (indice dans la liste des voisins).
    pub dir: usize,
    /// Secondes de jeu avant dissipation.
    pub reste: f64,
    /// Secondes avant le prochain deplacement.
    pub pas: f64,
}

/// Trou noir laisse par une bombe : il ne disparait jamais et grossit petit
/// a petit en avalant tout ce qu'il atteint.
#[derive(Serialize, Deserialize, Clone)]
pub struct TrouNoir {
    pub id: u32,
    pub case: usize,
    /// Rayon en cases (fractionnaire : il grossit en continu).
    pub rayon: f64,
}

/// Effet visuel ponctuel (explosions...) diffuse une seule fois.
#[derive(Serialize, Clone)]
pub struct Effet {
    pub genre: String,
    pub case: usize,
    /// Rayon de l'arme en cases (taille de l'animation), 0 = par defaut.
    pub rayon: u32,
}

#[derive(Serialize, Deserialize)]
pub struct Monde {
    pub largeur: usize,
    pub hauteur: usize,
    pub graine: u64,
    pub cases: Vec<Case>,
    pub pays: BTreeMap<u32, Pays>,
    pub armees: BTreeMap<u32, Armee>,
    pub missions: BTreeMap<u32, Mission>,
    pub missiles: BTreeMap<u32, MissileVol>,
    /// Cle "petit-grand" (ids de pays).
    pub relations: BTreeMap<String, Relation>,
    pub propositions: Vec<Proposition>,
    pub blocs: BTreeMap<u32, Bloc>,
    pub prix: Res,
    pub evenements: VecDeque<Evenement>,
    pub chat: VecDeque<MessageChat>,
    pub prochain_id: u32,
    pub prochain_msg: u64,
    pub rev: u64,
    /// Temps de jeu ecoule en secondes (vitesse incluse).
    pub temps: f64,
    #[serde(default)]
    pub nuages: Vec<Nuage>,
    #[serde(default)]
    pub trous_noirs: Vec<TrouNoir>,
    #[serde(default)]
    pub attaques: BTreeMap<u32, Attaque>,
    /// Version des regles de la sauvegarde (migrations dans jeu::migrer).
    #[serde(default)]
    pub version: u32,
    /// Nombre de bots choisi dans l'administration (sinon : config.json).
    #[serde(default)]
    pub bots_admin: Option<usize>,
    /// Cours des elements et produits au marche (1 = prix de reference) :
    /// baisse quand on vend, monte quand on achete, revient lentement a 1.
    #[serde(default)]
    pub cours: BTreeMap<String, f64>,
    #[serde(skip)]
    pub effets: Vec<Effet>,
    /// Carte du monde reel (vrais pays jouables).
    #[serde(default)]
    pub monde_reel: bool,
    /// Carte du monde : vrai pays de chaque case (index de pays_reels(),
    /// 0 = mer). Recalcule au chargement, jamais sauvegarde.
    #[serde(skip)]
    pub regions: Vec<u8>,
    /// Carte du monde : case de la capitale de chaque vrai pays (index 0
    /// inutilise).
    #[serde(skip)]
    pub capitales_reelles: Vec<usize>,
    // ── Demographie et religions (demographie.rs) ──
    /// Habitants « naturels » de chaque case (capacite d'accueil).
    #[serde(skip)]
    pub hab_base: Vec<f32>,
    /// Cases converties a une autre religion que celle d'origine.
    #[serde(default)]
    pub religions_changees: BTreeMap<usize, u8>,
    #[serde(default)]
    pub occupations: BTreeMap<usize, Occupation>,
    #[serde(default)]
    pub revoltes: BTreeMap<u32, Revolte>,
    /// Historique par nation : [unix, population, actifs, soldats,
    /// naissances/jour, deces/jour], un point toutes les 2 heures.
    #[serde(default)]
    pub histos: BTreeMap<u32, Vec<[f64; 6]>>,
    #[serde(skip)]
    pub demo_acc: f64,
    #[serde(skip)]
    pub occ_acc: f64,
}

// ── Geometrie hexagonale ──────────────────────────────────────────
impl Monde {
    pub fn xy(&self, i: usize) -> (i64, i64) {
        ((i % self.largeur) as i64, (i / self.largeur) as i64)
    }

    pub fn idx(&self, x: i64, y: i64) -> Option<usize> {
        if x < 0 || y < 0 || x >= self.largeur as i64 || y >= self.hauteur as i64 {
            None
        } else {
            Some(y as usize * self.largeur + x as usize)
        }
    }

    pub fn voisins(&self, i: usize) -> Vec<usize> {
        let (x, y) = self.xy(i);
        let d: [(i64, i64); 6] = if y & 1 == 0 {
            [(1, 0), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1)]
        } else {
            [(1, 0), (1, -1), (0, -1), (-1, 0), (0, 1), (1, 1)]
        };
        d.iter().filter_map(|(dx, dy)| self.idx(x + dx, y + dy)).collect()
    }

    fn cube(&self, i: usize) -> (i64, i64, i64) {
        let (x, y) = self.xy(i);
        let q = x - (y - (y & 1)) / 2;
        (q, y, -q - y)
    }

    pub fn distance(&self, a: usize, b: usize) -> i64 {
        let (ax, ay, az) = self.cube(a);
        let (bx, by, bz) = self.cube(b);
        (ax - bx).abs().max((ay - by).abs()).max((az - bz).abs())
    }

    /// Toutes les cases a distance <= r de c (c compris).
    pub fn rayon(&self, c: usize, r: i64) -> Vec<usize> {
        let (cx, cy) = self.xy(c);
        let mut v = Vec::new();
        for y in (cy - r - 1).max(0)..=(cy + r + 1).min(self.hauteur as i64 - 1) {
            for x in (cx - r - 1).max(0)..=(cx + r + 1).min(self.largeur as i64 - 1) {
                if let Some(i) = self.idx(x, y) {
                    if self.distance(c, i) <= r {
                        v.push(i);
                    }
                }
            }
        }
        v
    }

    /// Zone morte d'un trou noir : plus personne ne peut y vivre ni la prendre.
    pub fn zone_morte(&self, i: usize) -> bool {
        self.cases[i].irradiee > self.temps
    }

    pub fn est_cote(&self, i: usize) -> bool {
        est_terre(self.cases[i].terrain)
            && self.voisins(i).iter().any(|&v| !est_terre(self.cases[v].terrain) && self.cases[v].terrain != T_NEANT)
    }

    pub fn toucher(&mut self, i: usize) {
        self.rev += 1;
        self.cases[i].rev = self.rev;
    }

    pub fn nouvel_id(&mut self) -> u32 {
        self.prochain_id += 1;
        self.prochain_id
    }

    pub fn cle_rel(a: u32, b: u32) -> String {
        if a < b { format!("{}-{}", a, b) } else { format!("{}-{}", b, a) }
    }

    pub fn relation(&self, a: u32, b: u32) -> Etat {
        if a == b {
            return Etat::Paix;
        }
        self.relations
            .get(&Self::cle_rel(a, b))
            .map(|r| r.etat.clone())
            .unwrap_or(Etat::Paix)
    }

    pub fn en_guerre(&self, a: u32, b: u32) -> bool {
        a != b && self.relation(a, b) == Etat::Guerre
    }

    pub fn meme_bloc(&self, a: u32, b: u32) -> bool {
        if a == b {
            return true;
        }
        match (self.pays.get(&a).and_then(|p| p.bloc), self.pays.get(&b).and_then(|p| p.bloc)) {
            (Some(x), Some(y)) => x == y,
            _ => false,
        }
    }

    pub fn evenement(&mut self, pays: Option<u32>, genre: &str, texte: String, case: Option<usize>) {
        self.evenements.push_back(Evenement {
            t: chrono::Utc::now().timestamp_millis(),
            pays,
            genre: genre.to_string(),
            texte,
            case,
        });
        while self.evenements.len() > 600 {
            self.evenements.pop_front();
        }
    }

    pub fn nom_pays(&self, id: u32) -> String {
        self.pays.get(&id).map(|p| p.nom.clone()).unwrap_or_else(|| "?".into())
    }
}

// ── Generation de la carte ────────────────────────────────────────
/// Carte du monde reel (src/monde_reel.bin), decodee une fois.
struct CarteReelle {
    largeur: usize,
    hauteur: usize,
    terrains: Vec<u8>,
    /// Index du vrai pays (pays_reels()), 0 = aucun.
    pays: Vec<u8>,
}

fn monde_reel() -> &'static CarteReelle {
    static CARTE: std::sync::OnceLock<CarteReelle> = std::sync::OnceLock::new();
    CARTE.get_or_init(|| {
        let b: &[u8] = include_bytes!("monde_reel.bin");
        assert!(b.len() > 12 && &b[..8] == b"WFMONDE2", "monde_reel.bin invalide");
        let w = b[8] as usize | (b[9] as usize) << 8;
        let h = b[10] as usize | (b[11] as usize) << 8;
        let mut v = Vec::with_capacity(2 * w * h);
        for p in b[12..].chunks_exact(2) {
            v.extend(std::iter::repeat(p[1]).take(p[0] as usize));
        }
        v.resize(2 * w * h, 0);
        let pays = v.split_off(w * h);
        CarteReelle { largeur: w, hauteur: h, terrains: v, pays }
    })
}

/// Un vrai pays jouable (src/pays_reels.json, fabrique par outils/carte-monde).
#[derive(Deserialize, Serialize, Clone)]
pub struct PaysReel {
    pub code: String,
    pub nom: String,
    /// Capitale en coordonnees normalisees de la carte (0..1).
    pub capitale: [f64; 2],
}

/// Les vrais pays ; l'index 0 de la carte (mer) n'a pas d'entree :
/// le pays d'index k est pays_reels()[k - 1].
pub fn pays_reels() -> &'static [PaysReel] {
    static LISTE: std::sync::OnceLock<Vec<PaysReel>> = std::sync::OnceLock::new();
    LISTE.get_or_init(|| serde_json::from_str(include_str!("pays_reels.json")).expect("pays_reels.json invalide"))
}

/// Pays, terrain et capitales de la carte du monde a une taille donnee.
/// Deterministe : le meme calcul sert a la generation et au chargement.
struct DecoupageReel {
    terrains: Vec<u8>,
    regions: Vec<u8>,
    capitales: Vec<usize>,
}

/// Ressources reelles d'un pays (src/ressources_pays.json) : niveau 0 a 3
/// pour le petrole, le minerai commun, le minerai radioactif et le
/// minerai rare.
pub fn ressources_pays(code: &str) -> [u8; 4] {
    static TABLE: std::sync::OnceLock<HashMap<String, [u8; 4]>> = std::sync::OnceLock::new();
    let t = TABLE.get_or_init(|| {
        let brut: HashMap<String, serde_json::Value> = serde_json::from_str(include_str!("ressources_pays.json")).expect("ressources_pays.json invalide");
        brut.into_iter()
            .filter(|(_, v)| v.is_object())
            .map(|(k, v)| {
                let n = |c: &str| v.get(c).and_then(|x| x.as_u64()).unwrap_or(0).min(3) as u8;
                (k, [n("petrole"), n("commun"), n("radioactif"), n("rare")])
            })
            .collect()
    });
    t.get(code).copied().unwrap_or([0, 1, 0, 0])
}

/// Gisements de la carte du monde : places pays par pays d'apres ses
/// vraies ressources (petrole en Arabie saoudite, uranium au Kazakhstan…),
/// sur les terrains qui leur conviennent, regroupes en bassins. Les
/// crateres de meteorite (deja places) sont gardes.
fn placer_gisements_reels(cases: &mut [Case], regions: &[u8], largeur: usize, graine: u64) {
    const DEPOTS_REELS: [u8; 4] = [D_PETROLE, D_METAL, D_URANIUM, D_TERRES_RARES];
    // Nombre de gisements = COEF[niveau] x racine(cases du pays) : un petit
    // pays riche en petrole (Emirats, Koweit) en a beaucoup pour sa taille,
    // sans que les geants (Russie, Canada) n'en aient des centaines.
    const COEF: [f64; 4] = [0.0, 0.25, 0.6, 1.2];
    let bruit = Bruit { graine: graine.wrapping_add(31_337) };
    for c in cases.iter_mut() {
        if c.depot != D_METEORITE {
            c.depot = D_AUCUN;
        }
    }
    let mut par_pays: Vec<Vec<usize>> = vec![Vec::new(); pays_reels().len() + 1];
    for (i, &r) in regions.iter().enumerate() {
        if r != 0 && est_terre(cases[i].terrain) {
            par_pays[r as usize].push(i);
        }
    }
    for (k, liste) in par_pays.iter().enumerate().skip(1) {
        if liste.is_empty() {
            continue;
        }
        let niveaux = ressources_pays(&pays_reels()[k - 1].code);
        for (r, &depot) in DEPOTS_REELS.iter().enumerate() {
            let niv = niveaux[r] as usize;
            if niv == 0 {
                continue;
            }
            let voulus = ((COEF[niv] * (liste.len() as f64).sqrt()).round() as usize).max(1);
            let preference = |t: u8| -> f64 {
                match (r, t) {
                    (0, T_DESERT) => 3.0, (0, T_PLAINE | T_TOUNDRA) => 2.0, (0, T_MONTAGNE) => 0.0,
                    (1, T_COLLINE) => 3.0, (1, T_MONTAGNE | T_DESERT) => 2.0,
                    (2, T_COLLINE) => 3.0, (2, T_DESERT | T_TOUNDRA) => 2.0,
                    (3, T_COLLINE) => 3.0, (3, T_FORET) => 2.0,
                    _ => 1.0,
                }
            };
            let mut candidats: Vec<(f64, usize)> = liste
                .iter()
                // Pas de gisement en montagne : on ne peut pas y construire de mine.
                .filter(|&&i| cases[i].depot == D_AUCUN && cases[i].terrain != T_MONTAGNE)
                .map(|&i| {
                    let (x, y) = ((i % largeur) as f64, (i / largeur) as f64);
                    // Bassins : un bruit lent regroupe les gisements.
                    let bassin = bruit.fbm(x / 6.0 + r as f64 * 17.0, y / 6.0 + r as f64 * 5.0, 3);
                    let de = bruit.hash(i as i64, r as i64 + 1000);
                    (preference(cases[i].terrain) * 0.6 + bassin * 3.0 + de * 0.6, i)
                })
                .collect();
            candidats.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            for &(_, i) in candidats.iter().take(voulus) {
                cases[i].depot = depot;
            }
        }
    }
}

/// Taille minimale (en cases) d'un vrai pays pour etre jouable.
pub const MIN_CASES: usize = 30;

fn hauteur_monde_reel(largeur: usize) -> usize {
    let c = monde_reel();
    ((largeur as f64 * c.hauteur as f64 / c.largeur as f64 / 0.866).round() as usize).max(10)
}

fn decouper_monde_reel(largeur: usize, hauteur: usize) -> DecoupageReel {
    let c = monde_reel();
    let (rw, rh) = (c.largeur, c.hauteur);
    let (lw, lh) = (largeur as f64 + 0.5, (hauteur - 1) as f64 * 0.866 + 1.0);
    let point = |u: f64, v: f64| -> usize {
        let col = ((u * rw as f64) as isize).clamp(0, rw as isize - 1) as usize;
        let row = ((v * rh as f64) as isize).clamp(0, rh as isize - 1) as usize;
        row * rw + col
    };
    let n_pays = pays_reels().len();
    let mut terrains = vec![T_OCEAN; largeur * hauteur];
    let mut regions = vec![0u8; largeur * hauteur];
    for y in 0..hauteur {
        for x in 0..largeur {
            let px = x as f64 + if y % 2 == 1 { 0.5 } else { 0.0 };
            let py = y as f64 * 0.866;
            // Echantillons repartis sur l'hexagone : terre si au moins
            // 40 % de l'hexagone est emerge ; terrain le plus present
            // (les chaines de montagnes, fines, comptent davantage) ; pays
            // le plus present.
            let mut compte = [0usize; 8];
            let mut votes: Vec<(u8, usize)> = Vec::new();
            const N: usize = 5;
            for i in 0..N {
                for j in 0..N {
                    let ox = (i as f64 + 0.5) / N as f64 - 0.5;
                    let oy = ((j as f64 + 0.5) / N as f64 - 0.5) * 0.866;
                    let k = point((px + 0.5 + ox) / lw, (py + 0.5 + oy) / lh);
                    let t = (c.terrains[k] as usize).min(7);
                    compte[t] += 1;
                    if t >= 2 && c.pays[k] != 0 {
                        match votes.iter_mut().find(|v| v.0 == c.pays[k]) {
                            Some(v) => v.1 += 1,
                            None => votes.push((c.pays[k], 1)),
                        }
                    }
                }
            }
            let terre: usize = compte[2..].iter().sum();
            let i = y * largeur + x;
            if terre * 10 < N * N * 4 {
                continue;
            }
            terrains[i] = if compte[T_MONTAGNE as usize] * 10 >= terre * 3 {
                T_MONTAGNE
            } else {
                (2..8).max_by_key(|&t| compte[t]).unwrap_or(2) as u8
            };
            regions[i] = votes.iter().max_by_key(|v| v.1).map(|v| v.0).unwrap_or(0);
        }
    }
    let voisins = |i: usize| -> Vec<usize> {
        let (x, y) = ((i % largeur) as i64, (i / largeur) as i64);
        let d: [(i64, i64); 6] = if y % 2 == 0 {
            [(1, 0), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1)]
        } else {
            [(1, 0), (1, -1), (0, -1), (-1, 0), (0, 1), (1, 1)]
        };
        d.iter()
            .filter_map(|(dx, dy)| {
                let (nx, ny) = (x + dx, y + dy);
                (nx >= 0 && ny >= 0 && nx < largeur as i64 && ny < hauteur as i64).then(|| ny as usize * largeur + nx as usize)
            })
            .collect()
    };
    // Terre sans pays (rare, sur les cotes) : pays d'une case voisine.
    for _ in 0..4 {
        for i in 0..regions.len() {
            if terrains[i] != T_OCEAN && regions[i] == 0 {
                if let Some(v) = voisins(i).into_iter().find(|&v| regions[v] != 0) {
                    regions[i] = regions[v];
                }
            }
        }
    }
    let case_de = |u: f64, v: f64| -> usize {
        let row = ((v * lh - 0.5) / 0.866).round().clamp(0.0, (hauteur - 1) as f64) as usize;
        let col = (u * lw - 0.5 - if row % 2 == 1 { 0.5 } else { 0.0 }).round().clamp(0.0, (largeur - 1) as f64) as usize;
        row * largeur + col
    };
    // Les pays trop petits pour etre joues (moins de MIN_CASES cases :
    // micro-Etats, petites iles…) ne sont pas jouables : leurs terres
    // deviennent des terres libres, que leurs voisins peuvent conquerir.
    let mut taille = vec![0usize; n_pays + 1];
    for &r in &regions {
        taille[r as usize] += 1;
    }
    for r in regions.iter_mut() {
        if *r != 0 && taille[*r as usize] < MIN_CASES {
            *r = 0;
        }
    }
    // Plus aucune terre sans pays : chaque terre libre (micro-Etat retire,
    // ile isolee…) revient au pays jouable le plus proche (parcours en
    // largeur depuis toutes les terres des pays, a travers la mer aussi).
    {
        let mut proche = regions.clone();
        let mut file: std::collections::VecDeque<usize> = (0..proche.len()).filter(|&i| proche[i] != 0).collect();
        while let Some(i) = file.pop_front() {
            for v in voisins(i) {
                if proche[v] == 0 {
                    proche[v] = proche[i];
                    file.push_back(v);
                }
            }
        }
        for i in 0..regions.len() {
            if terrains[i] != T_OCEAN && regions[i] == 0 {
                regions[i] = proche[i];
            }
        }
        taille = vec![0usize; n_pays + 1];
        for &r in &regions {
            taille[r as usize] += 1;
        }
    }
    // Capitales : la case de la vraie capitale, ou la case du pays la plus
    // proche.
    let mut capitales = vec![usize::MAX; n_pays + 1];
    let dist = |a: usize, b: usize| -> f64 {
        let (ax, ay) = ((a % largeur) as f64 + if (a / largeur) % 2 == 1 { 0.5 } else { 0.0 }, (a / largeur) as f64 * 0.866);
        let (bx, by) = ((b % largeur) as f64 + if (b / largeur) % 2 == 1 { 0.5 } else { 0.0 }, (b / largeur) as f64 * 0.866);
        (ax - bx).hypot(ay - by)
    };
    for k in 1..=n_pays {
        if taille[k] < MIN_CASES {
            continue; // pays non jouable
        }
        let [u, v] = pays_reels()[k - 1].capitale;
        let c0 = case_de(u, v);
        capitales[k] = if regions[c0] as usize == k {
            c0
        } else {
            (0..regions.len())
                .filter(|&i| regions[i] as usize == k)
                .min_by(|&a, &b| dist(a, c0).partial_cmp(&dist(b, c0)).unwrap_or(std::cmp::Ordering::Equal))
                .unwrap_or(usize::MAX)
        };
    }
    DecoupageReel { terrains, regions, capitales }
}

struct Bruit {
    graine: u64,
}

impl Bruit {
    fn hash(&self, x: i64, y: i64) -> f64 {
        let mut h = (x as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
            ^ (y as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F)
            ^ self.graine.wrapping_mul(0x1656_67B1_9E37_79F9);
        h ^= h >> 31;
        h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        h ^= h >> 27;
        (h % 1_000_000) as f64 / 1_000_000.0
    }

    fn valeur(&self, x: f64, y: f64) -> f64 {
        let (x0, y0) = (x.floor() as i64, y.floor() as i64);
        let (fx, fy) = (x - x0 as f64, y - y0 as f64);
        let s = |t: f64| t * t * (3.0 - 2.0 * t);
        let (sx, sy) = (s(fx), s(fy));
        let a = self.hash(x0, y0);
        let b = self.hash(x0 + 1, y0);
        let c = self.hash(x0, y0 + 1);
        let d = self.hash(x0 + 1, y0 + 1);
        let h1 = a + (b - a) * sx;
        let h2 = c + (d - c) * sx;
        h1 + (h2 - h1) * sy
    }

    fn fbm(&self, x: f64, y: f64, octaves: u32) -> f64 {
        let (mut v, mut amp, mut freq, mut total) = (0.0, 1.0, 1.0, 0.0);
        for _ in 0..octaves {
            v += self.valeur(x * freq, y * freq) * amp;
            total += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        v / total
    }
}

impl Monde {
    pub fn generer(largeur: usize, hauteur: usize, graine: u64) -> Monde {
        let alt = Bruit { graine };
        let hum = Bruit { graine: graine.wrapping_add(7_919) };
        let tord = Bruit { graine: graine.wrapping_add(15_485_863) };

        // Chaque graine tire aussi la « forme » du monde : taille des
        // continents, niveau de la mer, deformation des cotes, climat.
        // Deux cartes ne se ressemblent donc plus seulement par le detail.
        let p = |k: i64| tord.hash(k, 977);
        let echelle = 7.0 + 9.0 * p(1); // 7 = archipels, 16 = grands continents
        let mer = -0.05 + 0.10 * p(2); // niveau de la mer
        let torsion = 2.0 + 7.0 * p(3); // cotes plus ou moins decoupees
        let bords = 0.25 + 0.25 * p(4); // poids de l'ocean sur les bords
        let echelle_hum = 5.0 + 7.0 * p(5);
        let secheresse = -0.06 + 0.12 * p(6);

        let mut cases = vec![Case::default(); largeur * hauteur];
        for y in 0..hauteur {
            for x in 0..largeur {
                // Position "reelle" du centre de l'hexagone.
                let px = x as f64 + if y % 2 == 1 { 0.5 } else { 0.0 };
                let py = y as f64 * 0.866;
                let nx = px / largeur as f64;
                let ny = py / (hauteur as f64 * 0.866);

                // Continents : bruit deforme (cotes irregulieres) + attenuation
                // vers les bords.
                let dx = torsion * (tord.fbm(px / 9.0, py / 9.0, 3) - 0.5);
                let dy = torsion * (tord.fbm(px / 9.0 + 41.0, py / 9.0 + 17.0, 3) - 0.5);
                let mut h = alt.fbm((px + dx) / echelle, (py + dy) / echelle, 5);
                let bord_x = (nx * (1.0 - nx) * 4.0).min(1.0);
                let bord_y = (ny * (1.0 - ny) * 4.0).min(1.0);
                h = h * (1.0 - bords + bords * bord_x.powf(0.5) * bord_y.powf(0.4)) - 0.05 * (1.0 - bord_y) + 0.03 - mer;
                let latitude = (ny - 0.5).abs() * 2.0; // 0 equateur, 1 pole
                let humid = hum.fbm(px / echelle_hum, py / echelle_hum, 4) - secheresse;

                let terrain = if h < 0.40 {
                    T_OCEAN
                } else if h < 0.44 {
                    T_MER
                } else if h > 0.69 {
                    T_MONTAGNE
                } else if h > 0.61 {
                    T_COLLINE
                } else if latitude > 0.66 {
                    T_TOUNDRA
                } else if latitude < 0.45 && humid < 0.42 {
                    T_DESERT
                } else if humid > 0.56 {
                    T_FORET
                } else {
                    T_PLAINE
                };
                cases[y * largeur + x].terrain = terrain;
            }
        }
        let mut m = Monde::depuis_terrains(largeur, hauteur, graine, cases);
        crate::demographie::preparer(&mut m);
        m
    }

    /// Carte du monde reel (src/monde_reel.bin, fabrique par
    /// outils/carte-monde) : vrais continents en projection Equal Earth,
    /// surfaces respectees. La hauteur se deduit de la largeur pour garder
    /// les vraies proportions. La graine ne change que les gisements.
    pub fn generer_monde_reel(largeur: usize, graine: u64) -> Monde {
        let hauteur = hauteur_monde_reel(largeur);
        let d = decouper_monde_reel(largeur, hauteur);
        let mut cases = vec![Case::default(); largeur * hauteur];
        for (c, &t) in cases.iter_mut().zip(&d.terrains) {
            c.terrain = t;
        }
        let mut m = Monde::depuis_terrains(largeur, hauteur, graine, cases);
        m.monde_reel = true;
        placer_gisements_reels(&mut m.cases, &d.regions, largeur, graine);
        // Pas d'ordinateur : le monde se joue entre joueurs.
        m.bots_admin = Some(0);
        m.regions = d.regions;
        m.capitales_reelles = d.capitales;
        crate::demographie::preparer(&mut m);
        m
    }

    /// Apres le chargement d'une sauvegarde : recalcule les vrais pays de
    /// chaque case (ils ne sont pas sauvegardes).
    pub fn preparer_regions(&mut self) {
        if self.monde_reel && self.hauteur == hauteur_monde_reel(self.largeur) {
            let d = decouper_monde_reel(self.largeur, self.hauteur);
            self.regions = d.regions;
            self.capitales_reelles = d.capitales;
        } else {
            self.monde_reel = false;
            self.regions.clear();
            self.capitales_reelles.clear();
        }
    }

    /// Position normalisee (0..1) du centre de la case sur la carte du monde.
    pub fn uv_case(&self, i: usize) -> (f64, f64) {
        let (x, y) = (i % self.largeur, i / self.largeur);
        let (lw, lh) = (self.largeur as f64 + 0.5, (self.hauteur - 1) as f64 * 0.866 + 1.0);
        let px = x as f64 + if y % 2 == 1 { 0.5 } else { 0.0 };
        ((px + 0.5) / lw, (y as f64 * 0.866 + 0.5) / lh)
    }

    /// Case la plus proche d'une position normalisee de la carte du monde.
    pub fn case_uv(&self, u: f64, v: f64) -> usize {
        let (lw, lh) = (self.largeur as f64 + 0.5, (self.hauteur - 1) as f64 * 0.866 + 1.0);
        let y = ((v * lh - 0.5) / 0.866).round().clamp(0.0, self.hauteur as f64 - 1.0) as usize;
        let dx = if y % 2 == 1 { 0.5 } else { 0.0 };
        let x = (u * lw - 0.5 - dx).round().clamp(0.0, self.largeur as f64 - 1.0) as usize;
        y * self.largeur + x
    }

    /// Vrai pays sous le centre de la case, petits pays compris (0 = mer).
    pub fn pays_au_centre(&self, i: usize) -> u8 {
        let c = monde_reel();
        let (u, v) = self.uv_case(i);
        let col = ((u * c.largeur as f64) as isize).clamp(0, c.largeur as isize - 1) as usize;
        let row = ((v * c.hauteur as f64) as isize).clamp(0, c.hauteur as isize - 1) as usize;
        c.pays[row * c.largeur + col]
    }

    /// Vrai pays d'une case (0 = aucun : mer ou terre libre).
    pub fn region(&self, i: usize) -> u8 {
        self.regions.get(i).copied().unwrap_or(0)
    }

    /// Le vrai pays k peut-il etre choisi (assez grand pour etre joue) ?
    pub fn pays_reel_jouable(&self, k: u8) -> bool {
        self.capitales_reelles.get(k as usize).map(|&c| c < self.cases.len()).unwrap_or(false)
    }

    /// Fin de la generation, commune aux deux cartes : mer cotiere,
    /// gisements, crateres.
    fn depuis_terrains(largeur: usize, hauteur: usize, graine: u64, cases: Vec<Case>) -> Monde {
        let res = Bruit { graine: graine.wrapping_add(104_729) };
        let mut monde = Monde {
            largeur,
            hauteur,
            graine,
            cases,
            pays: BTreeMap::new(),
            armees: BTreeMap::new(),
            missions: BTreeMap::new(),
            missiles: BTreeMap::new(),
            relations: BTreeMap::new(),
            propositions: Vec::new(),
            blocs: BTreeMap::new(),
            prix: RESSOURCES.map(|r| r.prix_base),
            evenements: VecDeque::new(),
            chat: VecDeque::new(),
            prochain_id: 0,
            prochain_msg: 0,
            rev: 1,
            temps: 0.0,
            nuages: Vec::new(),
            trous_noirs: Vec::new(),
            attaques: BTreeMap::new(),
            version: 4,
            bots_admin: None,
            cours: BTreeMap::new(),
            effets: Vec::new(),
            monde_reel: false,
            regions: Vec::new(),
            capitales_reelles: Vec::new(),
            hab_base: Vec::new(),
            religions_changees: BTreeMap::new(),
            occupations: BTreeMap::new(),
            revoltes: BTreeMap::new(),
            histos: BTreeMap::new(),
            demo_acc: 0.0,
            occ_acc: 0.0,
        };

        // La mer cotiere est la mer qui touche une terre ; le reste
        // redevient ocean profond.
        for i in 0..monde.cases.len() {
            let t = monde.cases[i].terrain;
            if t == T_MER || t == T_OCEAN {
                let pres_terre = monde.voisins(i).iter().any(|&v| est_terre(monde.cases[v].terrain));
                monde.cases[i].terrain = if pres_terre { T_MER } else { T_OCEAN };
            }
        }

        // Gisements : chaque ressource a ses terrains de predilection,
        // repartis par un bruit a basse frequence pour former des
        // regions riches (et donc des pays aux ressources propres).
        for i in 0..monde.cases.len() {
            let t = monde.cases[i].terrain;
            if !est_terre(t) {
                continue;
            }
            let (x, y) = monde.xy(i);
            let region = |k: f64| res.fbm(x as f64 / 6.0 + k, y as f64 / 6.0 + k * 1.7, 3);
            let de = res.hash(x * 31 + 7, y * 17 + 3);
            let depot = match t {
                T_DESERT if region(10.0) > 0.52 && de < 0.45 => D_METAL,
                T_PLAINE | T_TOUNDRA if region(10.0) > 0.60 && de < 0.18 => D_METAL,
                // Rien en montagne (on ne peut pas y construire) : les filons
                // sont dans les collines.
                T_COLLINE if region(20.0) > 0.66 && de < 0.30 => D_URANIUM,
                T_COLLINE if de < 0.40 => D_METAL,
                T_FORET | T_COLLINE if region(30.0) > 0.60 && de < 0.25 => D_TERRES_RARES,
                T_TOUNDRA if region(20.0) > 0.60 && de < 0.18 => D_URANIUM,
                T_DESERT if de < 0.08 => D_METAL,
                _ => D_AUCUN,
            };
            monde.cases[i].depot = depot;
        }

        // Crateres de meteorite : seule source de minerai legendaire. Tres
        // rares (un pour ~900 cases de terre, 3 au moins) et bien espaces.
        let mut terres: Vec<(f64, usize)> = (0..monde.cases.len())
            .filter(|&i| est_terre(monde.cases[i].terrain) && monde.cases[i].terrain != T_MONTAGNE)
            .map(|i| {
                let (x, y) = monde.xy(i);
                (res.hash(x * 101 + 13, y * 53 + 29), i)
            })
            .collect();
        terres.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let voulus = (terres.len() / 900).max(3);
        let mut crateres: Vec<usize> = Vec::new();
        for (_, i) in terres {
            if crateres.len() >= voulus {
                break;
            }
            if crateres.iter().all(|&c| monde.distance(c, i) >= 10) {
                monde.cases[i].depot = D_METEORITE;
                crateres.push(i);
            }
        }

        monde
    }
}

#[cfg(test)]
mod tests_monde_reel {
    use super::*;

    /// Case la plus proche d'un point (longitude, latitude), via la meme
    /// projection Equal Earth que outils/carte-monde.
    fn case_de(m: &Monde, lon: f64, lat: f64) -> usize {
        let (a1, a2, a3, a4, mm) = (1.340264, -0.081106, 0.000893, 0.003796, 3f64.sqrt() / 2.0);
        let proj = |lon: f64, lat: f64| {
            let t = (mm * lat.to_radians().sin()).asin();
            let (t2, t6) = (t * t, t.powi(6));
            let x = lon.to_radians() * t.cos() / (mm * (a1 + 3.0 * a2 * t2 + t6 * (7.0 * a3 + 9.0 * a4 * t2)));
            (x, t * (a1 + a2 * t2 + t6 * (a3 + a4 * t2)))
        };
        let xmax = proj(180.0, 0.0).0;
        let (yn, ys) = (proj(0.0, 83.0).1, proj(0.0, -56.0).1);
        let (lp, hp) = (2.0 * xmax * 1.04, (yn - ys) + 0.04 * 2.0 * xmax);
        let (x, y) = proj(lon, lat);
        let u = (x + xmax * 1.04) / lp;
        let v = (yn + 0.04 * xmax - y) / hp;
        let py = v * ((m.hauteur - 1) as f64 * 0.866 + 1.0) - 0.5;
        let row = (py / 0.866).round().clamp(0.0, (m.hauteur - 1) as f64) as usize;
        let px = u * (m.largeur as f64 + 0.5) - 0.5 - if row % 2 == 1 { 0.5 } else { 0.0 };
        row * m.largeur + px.round().clamp(0.0, (m.largeur - 1) as f64) as usize
    }

    #[test]
    fn la_carte_du_monde_est_reconnaissable() {
        let m = Monde::generer_monde_reel(256, 42);
        assert_eq!(m.largeur, 256);
        // Vraies proportions : environ 2,2 fois plus large que haute.
        let ratio = m.largeur as f64 / (m.hauteur as f64 * 0.866);
        assert!((2.0..2.5).contains(&ratio), "proportions {} x {}", m.largeur, m.hauteur);
        let terres = m.cases.iter().filter(|c| est_terre(c.terrain)).count() as f64 / m.cases.len() as f64;
        assert!((0.15..0.32).contains(&terres), "part de terres {terres}");
        let t = |lon, lat| m.cases[case_de(&m, lon, lat)].terrain;
        assert_eq!(t(10.0, 23.0), T_DESERT, "Sahara");
        assert_eq!(t(-62.0, -5.0), T_FORET, "Amazonie");
        assert_eq!(t(86.0, 28.0), T_MONTAGNE, "Himalaya");
        assert_eq!(t(-70.5, -33.0), T_MONTAGNE, "Andes (Aconcagua)");
        assert_eq!(t(88.0, 33.0), T_COLLINE, "plateau du Tibet : haut mais peu pentu, constructible");
        assert!(m.cases.iter().all(|c| c.terrain != T_MONTAGNE || c.depot == D_AUCUN), "aucun gisement en montagne");
        assert!(!est_terre(t(-40.0, 30.0)), "Atlantique");
        assert!(!est_terre(t(-150.0, 0.0)), "Pacifique");
        assert!(est_terre(t(2.5, 47.0)), "France");
        assert!(est_terre(t(134.0, -25.0)), "Australie");
        assert!(est_terre(t(-100.0, 40.0)), "Etats-Unis");
    }

    fn index_pays(code: &str) -> u8 {
        pays_reels().iter().position(|p| p.code == code).unwrap() as u8 + 1
    }

    #[test]
    fn chaque_vrai_pays_a_sa_place() {
        let m = Monde::generer_monde_reel(708, 3);
        assert!(m.monde_reel);
        assert_eq!(m.bots_admin, Some(0), "pas d'ordinateur sur la carte du monde");
        let n = pays_reels().len();
        assert!(n >= 195, "{n} pays");
        let mut taille = vec![0usize; n + 1];
        for &r in &m.regions {
            taille[r as usize] += 1;
        }
        let jouables = (1..=n).filter(|&k| m.pays_reel_jouable(k as u8)).count();
        assert!((90..140).contains(&jouables), "{jouables} pays jouables");
        // Plus aucune terre sans pays.
        let orphelines = (0..m.cases.len()).filter(|&i| est_terre(m.cases[i].terrain) && m.region(i) == 0).count();
        assert_eq!(orphelines, 0, "terres sans pays");
        for k in 1..=n {
            if m.pays_reel_jouable(k as u8) {
                assert!(taille[k] >= MIN_CASES, "{} : {} cases", pays_reels()[k - 1].nom, taille[k]);
                let c = m.capitales_reelles[k];
                assert_eq!(m.region(c) as usize, k, "capitale de {}", pays_reels()[k - 1].nom);
                assert!(est_terre(m.cases[c].terrain));
            } else {
                assert_eq!(taille[k], 0, "{} non jouable mais present", pays_reels()[k - 1].nom);
            }
        }
        // Micro-Etats : non jouables, leurs terres vont au voisin le plus proche.
        assert!(!m.pays_reel_jouable(index_pays("MC")) && !m.pays_reel_jouable(index_pays("LU")));
        // Vraies ressources : petrole saoudien, pas de petrole francais,
        // uranium kazakh.
        let gis = |code: &str, d: u8| (0..m.cases.len()).filter(|&i| m.region(i) == index_pays(code) && m.cases[i].depot == d).count();
        assert!(gis("SA", D_PETROLE) >= 20, "petrole saoudien : {}", gis("SA", D_PETROLE));
        assert!(gis("AE", D_PETROLE) >= 5, "petrole des Emirats : {}", gis("AE", D_PETROLE));
        assert_eq!(gis("FR", D_PETROLE), 0, "pas de petrole en France");
        assert!(gis("KZ", D_URANIUM) >= 20, "uranium kazakh");
        assert!(gis("RU", D_PETROLE) > gis("NO", D_PETROLE));
        // Grands pays bien plus grands que les petits.
        assert!(taille[index_pays("RU") as usize] > 20 * taille[index_pays("FR") as usize]);
        assert!(taille[index_pays("FR") as usize] > 15);
        // Outre-mer : le Groenland est danois, la Guyane francaise.
        assert_eq!(m.region(case_de(&m, -42.0, 72.0)), index_pays("DK"), "Groenland");
        assert_eq!(m.region(case_de(&m, -53.0, 4.0)), index_pays("FR"), "Guyane");
        assert_eq!(m.region(case_de(&m, 2.5, 47.0)), index_pays("FR"), "France");
        assert_eq!(m.region(case_de(&m, -100.0, 40.0)), index_pays("US"), "Etats-Unis");
        // Recalcul identique apres chargement.
        let mut m2: Monde = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
        assert!(m2.regions.is_empty());
        m2.preparer_regions();
        assert_eq!(m2.regions, m.regions);
        assert_eq!(m2.capitales_reelles, m.capitales_reelles);
    }

    #[test]
    fn un_joueur_prend_un_vrai_pays_libre() {
        use crate::jeu::{commande, Joueur, Regles};
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: true, largeur_monde: 708 };
        let mut m = Monde::generer_monde_reel(708, 9);
        let fr = index_pays("FR");
        let ja = Joueur { user_id: 1, nom: "Alice", admin: false, triche: false };
        let jb = Joueur { user_id: 2, nom: "Bob", admin: false, triche: false };
        let cmd = |k: u8| serde_json::json!({"action": "rejoindre", "pays_reel": k, "couleur": "#ef4444", "spe": "militaire"});
        assert!(commande(&mut m, &ja, &serde_json::json!({"action": "rejoindre", "couleur": "#ef4444", "spe": "militaire"}), &regles).is_err(), "pays obligatoire");
        commande(&mut m, &ja, &cmd(fr), &regles).unwrap();
        let p = m.pays.values().find(|p| p.user_id == 1).unwrap();
        assert_eq!(p.nom, "France");
        assert_eq!(p.pays_reel, fr);
        assert_eq!(p.capitale, m.capitales_reelles[fr as usize]);
        let a_elle = m.cases.iter().enumerate().filter(|(_, c)| c.proprio == Some(p.id)).count();
        let total = m.regions.iter().filter(|&&r| r == fr).count();
        assert_eq!(a_elle, total, "toute la France, outre-mer compris");
        // Deja pris.
        let e = commande(&mut m, &jb, &cmd(fr), &regles).unwrap_err();
        assert!(e.contains("Alice"), "{e}");
        // Un micro-Etat n'est pas jouable.
        assert!(commande(&mut m, &jb, &cmd(index_pays("LU")), &regles).is_err(), "Luxembourg");
        commande(&mut m, &jb, &cmd(index_pays("DE")), &regles).unwrap();
        assert_eq!(m.pays.values().find(|p| p.user_id == 2).unwrap().nom, "Allemagne");
    }

    #[test]
    fn habitants_religions_et_revoltes_du_monde() {
        use crate::jeu::{commande, tick, Joueur, Regles};
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: true, largeur_monde: 708 };
        let mut m = Monde::generer_monde_reel(708, 3);
        // Les vraies religions aux vrais endroits.
        let rel = |m: &Monde, lon: f64, lat: f64| m.cases[case_de(m, lon, lat)].rel;
        for (lieu, lon, lat, r) in [
            ("Paris", 2.35, 48.85, 1), ("Riyad", 46.7, 24.7, 4), ("Teheran", 51.4, 35.7, 5), ("Delhi", 77.2, 28.6, 6),
            ("Bangkok", 100.5, 13.75, 7), ("Tokyo", 139.7, 35.7, 11), ("Moscou", 37.6, 55.75, 3), ("Pekin", 116.4, 39.9, 10),
            ("Kano", 8.5, 12.0, 4), ("Lagos", 3.4, 6.6, 2), ("Pendjab", 75.8, 31.0, 12), ("Mexico", -99.1, 19.4, 1),
        ] {
            assert_eq!(rel(&m, lon, lat), r, "{lieu}");
        }
        // Toutes les terres sont peuplees, meme sans proprietaire.
        let terres = m.cases.iter().filter(|c| est_terre(c.terrain)).count();
        let peuplees = m.cases.iter().filter(|c| est_terre(c.terrain) && c.hab > 0.0).count();
        assert!(peuplees * 100 >= terres * 99, "{peuplees}/{terres}");
        // Population ecrasee : France ~650 000, Inde ~5 millions.
        let ja = Joueur { user_id: 1, nom: "Alice", admin: false, triche: false };
        let jb = Joueur { user_id: 2, nom: "Bob", admin: false, triche: false };
        let cmd = |k: u8| serde_json::json!({"action": "rejoindre", "pays_reel": k, "couleur": "#ef4444", "spe": "militaire"});
        commande(&mut m, &ja, &cmd(index_pays("FR")), &regles).unwrap();
        commande(&mut m, &jb, &cmd(index_pays("IN")), &regles).unwrap();
        let fr = m.pays.values().find(|p| p.user_id == 1).unwrap().id;
        let ind = m.pays.values().find(|p| p.user_id == 2).unwrap().id;
        assert!(m.pays[&fr].pop > 600.0 && m.pays[&fr].pop < 1100.0, "France {}", m.pays[&fr].pop);
        assert!(m.pays[&ind].pop > 4500.0 && m.pays[&ind].pop < 6500.0, "Inde {}", m.pays[&ind].pop);
        assert_eq!(m.pays[&fr].religion, 1);
        assert_eq!(m.pays[&ind].religion, 6);
        // Une journee reelle = une annee : quelques naissances et deces.
        let avant = m.pays[&fr].pop;
        let enfants0 = m.pays[&fr].ages[0];
        for _ in 0..144 {
            tick(&mut m, 600.0);
        }
        let p = &m.pays[&fr];
        assert!(p.naissances > 1000.0 && p.deces > 1000.0, "naissances {} deces {}", p.naissances, p.deces);
        assert!((p.pop / avant - 1.0).abs() < 0.03, "{} -> {}", avant, p.pop);
        assert!(p.ages[0] > 0.0 && (p.ages[0] - enfants0).abs() < enfants0, "nouveaux-nes");
        let somme: f64 = m.cases.iter().filter(|c| c.proprio == Some(fr)).map(|c| c.hab as f64).sum();
        assert!((somme / 1000.0 - p.pop).abs() < 1.0, "cases {} pays {}", somme / 1000.0, p.pop);
        // Une case algerienne (sunnite) prise par la France se revolte ; les
        // troupes envoyees retablissent l'ordre.
        let alger = case_de(&m, 3.0, 36.0);
        let alger = (0..m.cases.len()).filter(|&i| m.cases[i].rel == 4 && est_terre(m.cases[i].terrain)).min_by_key(|&i| m.distance(i, alger)).unwrap();
        m.cases[alger].proprio = Some(fr);
        crate::demographie::demarrer_revolte(&mut m, fr, alger);
        let id = *m.revoltes.keys().next().unwrap();
        assert!(m.cases[alger].revolte);
        m.pays.get_mut(&fr).unwrap().troupes = 5000.0;
        crate::demographie::reprimer(&mut m, fr, id, 3000.0).unwrap();
        for _ in 0..120 {
            tick(&mut m, 1.0);
        }
        assert!(m.revoltes.is_empty(), "revolte matee");
        assert!(!m.cases[alger].revolte && m.cases[alger].proprio == Some(fr));
        // Sans maintien de l'ordre, la region devient neutre au bout du delai.
        crate::demographie::demarrer_revolte(&mut m, fr, alger);
        for r in m.revoltes.values_mut() {
            r.limite = 0;
        }
        tick(&mut m, 1.0);
        assert!(m.revoltes.is_empty());
        assert_eq!(m.cases[alger].proprio, None, "region neutre apres la revolte");
    }

    #[test]
    fn on_ne_construit_pas_en_montagne() {
        use crate::jeu::{commande, Joueur, Regles};
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: true, largeur_monde: 708 };
        let mut m = Monde::generer_monde_reel(708, 5);
        let j = Joueur { user_id: 7, nom: "Nora", admin: false, triche: false };
        commande(&mut m, &j, &serde_json::json!({"action": "rejoindre", "pays_reel": index_pays("NP"), "couleur": "#ef4444", "spe": "militaire"}), &regles).unwrap();
        let pid = m.pays.values().find(|p| p.user_id == 7).unwrap().id;
        let mont = (0..m.cases.len()).find(|&i| m.cases[i].proprio == Some(pid) && m.cases[i].terrain == T_MONTAGNE && m.cases[i].bat.is_none()).expect("le Nepal a des montagnes");
        let e = commande(&mut m, &j, &serde_json::json!({"action": "construire", "case": mont, "bat": "carriere"}), &regles).unwrap_err();
        assert!(e.contains("montagne"), "{e}");
        let plat = (0..m.cases.len()).find(|&i| m.cases[i].proprio == Some(pid) && m.cases[i].terrain != T_MONTAGNE && m.cases[i].bat.is_none()).unwrap();
        commande(&mut m, &j, &serde_json::json!({"action": "construire", "case": plat, "bat": "carriere"}), &regles).unwrap();
    }

    #[test]
    fn la_taille_suit_la_largeur() {
        for l in [60, 128, 300] {
            let m = Monde::generer_monde_reel(l, 1);
            assert_eq!(m.cases.len(), m.largeur * m.hauteur);
            assert!(m.cases.iter().filter(|c| est_terre(c.terrain)).count() > l * 2);
        }
    }
}


#[cfg(test)]
mod statistiques_monde_reel {
    /// `cargo test statistiques -- --ignored --nocapture` : pays jouables,
    /// leur taille et leurs gisements sur la carte du monde.
    #[test]
    #[ignore]
    fn statistiques() {
        use crate::defs::*;
        let m = super::Monde::generer_monde_reel(708, 1);
        let n = super::pays_reels().len();
        let mut t = vec![(0usize, [0usize; 4]); n + 1];
        for (i, c) in m.cases.iter().enumerate() {
            let k = m.region(i) as usize;
            t[k].0 += 1;
            if let Some(g) = [D_PETROLE, D_METAL, D_URANIUM, D_TERRES_RARES].iter().position(|&d| d == c.depot) {
                t[k].1[g] += 1;
            }
        }
        let mut v: Vec<_> = (1..=n).filter(|&k| m.pays_reel_jouable(k as u8)).map(|k| (t[k].0, super::pays_reels()[k - 1].nom.clone(), t[k].1)).collect();
        v.sort();
        println!("{} x {} = {} cases, {} pays jouables", m.largeur, m.hauteur, m.cases.len(), v.len());
        for (c, nom, g) in &v {
            println!("{:>5} cases  petrole {:>3}  commun {:>3}  radioactif {:>3}  rare {:>3}  {}", c, g[0], g[1], g[2], g[3], nom);
        }
    }
}
