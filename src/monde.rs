// ══════════════════════════════════════════════════════════════════
// monde.rs — Etat du monde (serialise tel quel dans data/monde.json)
// Grille hexagonale en coordonnees "odd-r" : les lignes impaires sont
// decalees d'une demi-case vers la droite. Case = index y * largeur + x.
// ══════════════════════════════════════════════════════════════════

use crate::defs::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

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
/// Carte du monde reel, decodee une fois : (largeur, hauteur, terrains).
fn monde_reel() -> &'static (usize, usize, Vec<u8>) {
    static CARTE: std::sync::OnceLock<(usize, usize, Vec<u8>)> = std::sync::OnceLock::new();
    CARTE.get_or_init(|| {
        let b: &[u8] = include_bytes!("monde_reel.bin");
        assert!(b.len() > 12 && &b[..8] == b"WFMONDE1", "monde_reel.bin invalide");
        let w = b[8] as usize | (b[9] as usize) << 8;
        let h = b[10] as usize | (b[11] as usize) << 8;
        let mut v = Vec::with_capacity(w * h);
        for p in b[12..].chunks_exact(2) {
            v.extend(std::iter::repeat(p[1]).take(p[0] as usize));
        }
        v.resize(w * h, T_OCEAN);
        (w, h, v)
    })
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
        Monde::depuis_terrains(largeur, hauteur, graine, cases)
    }

    /// Carte du monde reel (src/monde_reel.bin, fabrique par
    /// outils/carte-monde) : vrais continents en projection Equal Earth,
    /// surfaces respectees. La hauteur se deduit de la largeur pour garder
    /// les vraies proportions. La graine ne change que les gisements.
    pub fn generer_monde_reel(largeur: usize, graine: u64) -> Monde {
        let (rw, rh, raster) = monde_reel();
        let (rw, rh) = (*rw, *rh);
        let hauteur = ((largeur as f64 * rh as f64 / rw as f64 / 0.866).round() as usize).max(10);
        let (lw, lh) = (largeur as f64 + 0.5, (hauteur - 1) as f64 * 0.866 + 1.0);
        let lire = |u: f64, v: f64| -> u8 {
            let c = ((u * rw as f64) as isize).clamp(0, rw as isize - 1) as usize;
            let r = ((v * rh as f64) as isize).clamp(0, rh as isize - 1) as usize;
            raster[r * rw + c]
        };
        let mut cases = vec![Case::default(); largeur * hauteur];
        for y in 0..hauteur {
            for x in 0..largeur {
                let px = x as f64 + if y % 2 == 1 { 0.5 } else { 0.0 };
                let py = y as f64 * 0.866;
                // Echantillons repartis sur l'hexagone : terre si au moins
                // 40 % de l'hexagone est emerge ; terrain le plus present
                // (les chaines de montagnes, fines, comptent davantage).
                let mut compte = [0usize; 8];
                const N: usize = 5;
                for i in 0..N {
                    for j in 0..N {
                        let ox = (i as f64 + 0.5) / N as f64 - 0.5;
                        let oy = ((j as f64 + 0.5) / N as f64 - 0.5) * 0.866;
                        let t = lire((px + 0.5 + ox) / lw, (py + 0.5 + oy) / lh) as usize;
                        compte[t.min(7)] += 1;
                    }
                }
                let terre: usize = compte[2..].iter().sum();
                cases[y * largeur + x].terrain = if terre * 10 < N * N * 4 {
                    T_OCEAN
                } else if compte[T_MONTAGNE as usize] * 10 >= terre * 3 {
                    T_MONTAGNE
                } else {
                    (2..8).max_by_key(|&t| compte[t]).unwrap_or(2) as u8
                };
            }
        }
        Monde::depuis_terrains(largeur, hauteur, graine, cases)
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
                T_MONTAGNE | T_COLLINE if region(20.0) > 0.66 && de < 0.30 => D_URANIUM,
                T_COLLINE | T_MONTAGNE if de < 0.40 => D_METAL,
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
            .filter(|&i| est_terre(monde.cases[i].terrain))
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
        assert!(!est_terre(t(-40.0, 30.0)), "Atlantique");
        assert!(!est_terre(t(-150.0, 0.0)), "Pacifique");
        assert!(est_terre(t(2.5, 47.0)), "France");
        assert!(est_terre(t(134.0, -25.0)), "Australie");
        assert!(est_terre(t(-100.0, 40.0)), "Etats-Unis");
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
