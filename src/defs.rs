// ══════════════════════════════════════════════════════════════════
// defs.rs — Contenu du jeu (donnees statiques)
// Ressources, terrains, gisements, batiments, unites, technologies,
// specialisations nationales. Tout le reste du serveur lit ces tables ;
// le client les recoit telles quelles a la connexion (message "init").
// ══════════════════════════════════════════════════════════════════

use serde::Serialize;

// ── Ressources ────────────────────────────────────────────────────
// Les 4 minerais SONT les ressources de base (plus de petrole) : ce que
// coutent les batiments et les unites, ce que la raffinerie transforme en
// elements du tableau periodique.
pub const NB_RES: usize = 6;
pub const CR: usize = 0; // Credits
pub const NO: usize = 1; // Nourriture (retiree du jeu : toujours 0)
pub const ME: usize = 2; // Minerai commun
pub const LE: usize = 3; // Minerai legendaire
pub const UR: usize = 4; // Minerai radioactif
pub const TR: usize = 5; // Minerai rare

pub type Res = [f64; NB_RES];

#[derive(Serialize)]
pub struct ResDef {
    pub id: &'static str,
    pub nom: &'static str,
    pub icone: &'static str,
    pub couleur: &'static str,
    /// Prix de reference sur le marche mondial (en credits). 0 = non echangeable.
    pub prix_base: f64,
}

pub const RESSOURCES: [ResDef; NB_RES] = [
    ResDef { id: "credits", nom: "Crédits", icone: "coins", couleur: "#f59e0b", prix_base: 0.0 },
    ResDef { id: "nourriture", nom: "Nourriture", icone: "wheat-awn", couleur: "#84cc16", prix_base: 0.0 },
    ResDef { id: "minerai_commun", nom: "Minerai commun", icone: "mountain", couleur: "#94a3b8", prix_base: 4.0 },
    // Introuvable au marche : seulement dans les crateres de meteorite.
    ResDef { id: "minerai_legendaire", nom: "Minerai légendaire", icone: "meteor", couleur: "#f43f5e", prix_base: 0.0 },
    ResDef { id: "minerai_radioactif", nom: "Minerai radioactif", icone: "radiation", couleur: "#22c55e", prix_base: 28.0 },
    ResDef { id: "minerai_rare", nom: "Minerai rare", icone: "gem", couleur: "#a855f7", prix_base: 32.0 },
];

// ── Terrains ──────────────────────────────────────────────────────
pub const T_OCEAN: u8 = 0;
pub const T_MER: u8 = 1;
pub const T_PLAINE: u8 = 2;
pub const T_FORET: u8 = 3;
pub const T_COLLINE: u8 = 4;
pub const T_MONTAGNE: u8 = 5;
pub const T_DESERT: u8 = 6;
pub const T_TOUNDRA: u8 = 7;

#[derive(Serialize)]
pub struct TerrainDef {
    pub id: u8,
    pub nom: &'static str,
    pub couleur: &'static str,
    pub terre: bool,
    /// Multiplicateur du temps de traversee.
    pub cout_mvt: f64,
    /// Bonus de defense des troupes stationnees (0.25 = +25 %).
    pub defense: f64,
    /// Hauteur relative pour le rendu 3D.
    pub hauteur: f64,
}

pub const TERRAINS: [TerrainDef; 8] = [
    TerrainDef { id: T_OCEAN, nom: "Océan", couleur: "#1e4f7a", terre: false, cout_mvt: 1.0, defense: 0.0, hauteur: 0.05 },
    TerrainDef { id: T_MER, nom: "Mer côtière", couleur: "#2f7bb0", terre: false, cout_mvt: 1.0, defense: 0.0, hauteur: 0.1 },
    TerrainDef { id: T_PLAINE, nom: "Plaine", couleur: "#8fbf5a", terre: true, cout_mvt: 1.0, defense: 0.0, hauteur: 0.35 },
    TerrainDef { id: T_FORET, nom: "Forêt", couleur: "#3f7d3a", terre: true, cout_mvt: 1.5, defense: 0.25, hauteur: 0.45 },
    TerrainDef { id: T_COLLINE, nom: "Collines", couleur: "#a8a15c", terre: true, cout_mvt: 1.6, defense: 0.35, hauteur: 0.65 },
    TerrainDef { id: T_MONTAGNE, nom: "Montagnes", couleur: "#8a8176", terre: true, cout_mvt: 2.5, defense: 0.7, hauteur: 1.1 },
    TerrainDef { id: T_DESERT, nom: "Désert", couleur: "#d9c27e", terre: true, cout_mvt: 1.3, defense: 0.0, hauteur: 0.38 },
    TerrainDef { id: T_TOUNDRA, nom: "Toundra", couleur: "#b9c6c9", terre: true, cout_mvt: 1.4, defense: 0.1, hauteur: 0.42 },
];

pub fn est_terre(t: u8) -> bool {
    TERRAINS.get(t as usize).map(|d| d.terre).unwrap_or(false)
}

// ── Gisements ─────────────────────────────────────────────────────
pub const D_AUCUN: u8 = 0;
pub const D_PETROLE: u8 = 1;
pub const D_METAL: u8 = 2;
pub const D_URANIUM: u8 = 3;
pub const D_TERRES_RARES: u8 = 4;
pub const D_FERTILE: u8 = 5;
pub const D_METEORITE: u8 = 6;

#[derive(Serialize)]
pub struct DepotDef {
    pub id: u8,
    pub nom: &'static str,
    pub icone: &'static str,
    pub couleur: &'static str,
}

pub const DEPOTS: [DepotDef; 7] = [
    DepotDef { id: D_AUCUN, nom: "Aucun", icone: "", couleur: "" },
    DepotDef { id: D_PETROLE, nom: "Ancien gisement (épuisé)", icone: "mountain", couleur: "#64748b" },
    DepotDef { id: D_METAL, nom: "Filon de minerai commun", icone: "mountain", couleur: "#94a3b8" },
    DepotDef { id: D_URANIUM, nom: "Gisement de minerai radioactif", icone: "radiation", couleur: "#22c55e" },
    DepotDef { id: D_TERRES_RARES, nom: "Gisement de minerai rare", icone: "gem", couleur: "#a855f7" },
    DepotDef { id: D_FERTILE, nom: "Sol fertile", icone: "seedling", couleur: "#65a30d" },
    DepotDef { id: D_METEORITE, nom: "Cratère de météorite", icone: "meteor", couleur: "#f43f5e" },
];

// ── Batiments ─────────────────────────────────────────────────────
#[derive(Serialize)]
pub struct BatDef {
    pub id: &'static str,
    pub nom: &'static str,
    pub icone: &'static str,
    pub categorie: &'static str,
    pub desc: &'static str,
    /// Cout du niveau 1 ; niveau n = cout * 1.7^(n-1).
    pub cout: Res,
    /// Temps du niveau 1 en secondes ; niveau n = temps * 1.45^(n-1).
    pub temps: f64,
    pub tech: &'static str,
    pub depot: u8,
    pub cote: bool,
    /// Electricite par niveau : positif = produit, negatif = consomme.
    pub elec: f64,
    pub constructible: bool,
}

/// Cout : credits, nourriture, minerai commun, (ancien petrole, compte en
/// minerai commun), minerai radioactif, minerai rare.
/// Cout d'un batiment ou d'une unite. Reequilibrage du 2026-10-05 (simulation
/// d'une heure : credits toujours a zero, minerai commun entasse) : 40 % du
/// cout en credits est paye en minerai commun (1 minerai pour 2 credits).
/// La nourriture a ete retiree du jeu : son ancien cout est ignore.
const fn r(cr: f64, no: f64, me: f64, pe: f64, ur: f64, tr: f64) -> Res {
    let _ = no;
    [cr * 0.6, 0.0, me + pe + cr * 0.2, 0.0, ur, tr]
}

pub const BATIMENTS: &[BatDef] = &[
    BatDef { id: "capitale", nom: "Capitale", icone: "landmark", categorie: "Administration",
        desc: "Cœur de la nation : revenus de base, logement, électricité et recherche. Si elle tombe, le gouvernement se replie ailleurs.",
        cout: r(900.0, 0.0, 300.0, 0.0, 0.0, 0.0), temps: 60.0, tech: "", depot: D_AUCUN, cote: false, elec: 30.0, constructible: false },
    BatDef { id: "ville", nom: "Ville", icone: "city", categorie: "Administration",
        desc: "Loge la population (+140 k par niveau), rapporte des impôts et augmente le maximum de troupes.",
        cout: r(220.0, 40.0, 60.0, 0.0, 0.0, 0.0), temps: 40.0, tech: "", depot: D_AUCUN, cote: false, elec: -3.0, constructible: true },
    BatDef { id: "centre_admin", nom: "Centre administratif", icone: "building-columns", categorie: "Administration",
        desc: "Augmente le maximum de troupes (+440 par niveau) et produit de l'influence.",
        cout: r(300.0, 0.0, 80.0, 0.0, 0.0, 0.0), temps: 50.0, tech: "", depot: D_AUCUN, cote: false, elec: -2.0, constructible: true },
    BatDef { id: "ambassade", nom: "Ambassade", icone: "handshake", categorie: "Administration",
        desc: "Produit beaucoup d'influence et protège contre l'espionnage adverse.",
        cout: r(350.0, 0.0, 60.0, 0.0, 0.0, 20.0), temps: 60.0, tech: "dip_ambassades", depot: D_AUCUN, cote: false, elec: -2.0, constructible: true },
    BatDef { id: "ferme", nom: "Ancienne ferme", icone: "tractor", categorie: "Production",
        desc: "Vestige d\'avant : la nourriture n\'existe plus dans le jeu.",
        cout: r(120.0, 0.0, 30.0, 0.0, 0.0, 0.0), temps: 25.0, tech: "", depot: D_AUCUN, cote: false, elec: 0.0, constructible: false },
    BatDef { id: "mine", nom: "Mine commune", icone: "person-digging", categorie: "Production",
        desc: "Extrait du minerai commun d'un filon (+25/min par niveau).",
        cout: r(160.0, 0.0, 20.0, 0.0, 0.0, 0.0), temps: 30.0, tech: "", depot: D_METAL, cote: false, elec: -2.0, constructible: true },
    BatDef { id: "puits_petrole", nom: "Ancien puits", icone: "oil-well", categorie: "Production",
        desc: "Vestige d'avant les minerais : rapporte un peu de minerai commun (+4/min par niveau). Ne se construit plus.",
        cout: r(180.0, 0.0, 60.0, 0.0, 0.0, 0.0), temps: 35.0, tech: "", depot: D_PETROLE, cote: false, elec: -2.0, constructible: false },
    BatDef { id: "mine_uranium", nom: "Mine radioactive", icone: "radiation", categorie: "Production",
        desc: "Extrait du minerai radioactif (+8/min par niveau) : uranium, thorium, plutonium… Indispensable au nucléaire.",
        cout: r(500.0, 0.0, 180.0, 40.0, 0.0, 0.0), temps: 70.0, tech: "", depot: D_URANIUM, cote: false, elec: -4.0, constructible: true },
    BatDef { id: "extracteur_tr", nom: "Mine rare", icone: "gem", categorie: "Production",
        desc: "Extrait du minerai rare (+8/min par niveau) : terres rares et métaux précieux, nécessaires à l'électronique.",
        cout: r(550.0, 0.0, 200.0, 50.0, 0.0, 0.0), temps: 70.0, tech: "", depot: D_TERRES_RARES, cote: false, elec: -5.0, constructible: true },
    BatDef { id: "carriere", nom: "Carrière", icone: "mountain", categorie: "Production",
        desc: "Se construit n'importe où. Extrait le minerai du sol : commun (+10/min par niveau), ou celui du gisement sur lequel elle est posée (rare ou radioactif +4/min, légendaire +1/min), moins qu'une vraie mine.",
        cout: r(140.0, 0.0, 30.0, 0.0, 0.0, 0.0), temps: 25.0, tech: "", depot: D_AUCUN, cote: false, elec: -1.0, constructible: true },
    BatDef { id: "foreuse", nom: "Mine légendaire", icone: "meteor", categorie: "Production",
        desc: "Extrait du minerai légendaire d'un cratère de météorite (+2/min par niveau). Les éléments qu'on en tire se désintègrent vite.",
        cout: r(2500.0, 0.0, 800.0, 200.0, 50.0, 80.0), temps: 150.0, tech: "", depot: D_METEORITE, cote: false, elec: -15.0, constructible: true },
    BatDef { id: "raffinerie", nom: "Raffinerie", icone: "flask-vial", categorie: "Industrie",
        desc: "Transforme les minerais en n'importe lequel des 118 éléments du tableau périodique. Chaque niveau raffine plus vite.",
        cout: r(450.0, 0.0, 200.0, 40.0, 0.0, 0.0), temps: 50.0, tech: "", depot: D_AUCUN, cote: false, elec: -6.0, constructible: true },
    BatDef { id: "fabrique", nom: "Fabrique", icone: "gears", categorie: "Industrie",
        desc: "Ancien atelier, remplacé par le complexe industriel (il compte comme tel).",
        cout: r(600.0, 0.0, 280.0, 40.0, 0.0, 10.0), temps: 60.0, tech: "", depot: D_AUCUN, cote: false, elec: -10.0, constructible: false },
    BatDef { id: "centrale_thermique", nom: "Centrale thermique", icone: "fire-flame-curved", categorie: "Énergie",
        desc: "Produit +45 d'électricité par niveau en brûlant 3 minerai commun/min par niveau (charbon).",
        cout: r(260.0, 0.0, 120.0, 20.0, 0.0, 0.0), temps: 40.0, tech: "", depot: D_AUCUN, cote: false, elec: 45.0, constructible: true },
    BatDef { id: "parc_solaire", nom: "Parc solaire", icone: "solar-panel", categorie: "Énergie",
        desc: "Électricité propre : +22 par niveau, sans combustible.",
        cout: r(320.0, 0.0, 80.0, 0.0, 0.0, 10.0), temps: 45.0, tech: "eco_energies", depot: D_AUCUN, cote: false, elec: 22.0, constructible: true },
    BatDef { id: "centrale_nucleaire", nom: "Centrale nucléaire", icone: "atom", categorie: "Énergie",
        desc: "Beaucoup d'électricité, en consommant de l'uranium enrichi. Sans la technologie Nucléaire civil : 25 % de risque d'accident à chaque mise en service (nuage radioactif).",
        cout: r(1400.0, 0.0, 500.0, 0.0, 40.0, 30.0), temps: 120.0, tech: "", depot: D_AUCUN, cote: false, elec: 170.0, constructible: true },
    BatDef { id: "enrichissement", nom: "Centre d'enrichissement", icone: "flask-vial", categorie: "Énergie",
        desc: "Enrichit le minerai radioactif (extrait ou acheté) : 1,5 minerai donne 1 uranium enrichi, par minute et par niveau. Indispensable aux centrales et aux bombes nucléaires.",
        cout: r(600.0, 0.0, 250.0, 40.0, 0.0, 10.0), temps: 70.0, tech: "", depot: D_AUCUN, cote: false, elec: -10.0, constructible: true },
    BatDef { id: "usine", nom: "Complexe industriel", icone: "industry", categorie: "Industrie",
        desc: "Table de fabrication : assemble tous les produits à partir des éléments raffinés (son niveau fixe la complexité des recettes, niveau 8 : le trou noir). Aussi +12 % de vitesse de construction par niveau.",
        cout: r(380.0, 0.0, 160.0, 20.0, 0.0, 0.0), temps: 55.0, tech: "", depot: D_AUCUN, cote: false, elec: -8.0, constructible: true },
    BatDef { id: "laboratoire", nom: "Laboratoire", icone: "flask", categorie: "Industrie",
        desc: "Produit des points de recherche (+15/min par niveau).",
        cout: r(300.0, 0.0, 90.0, 0.0, 0.0, 0.0), temps: 45.0, tech: "", depot: D_AUCUN, cote: false, elec: -6.0, constructible: true },
    BatDef { id: "entrepot", nom: "Entrepôt", icone: "warehouse", categorie: "Industrie",
        desc: "Augmente la capacité de stockage de toutes les ressources (+4 000 par niveau).",
        cout: r(150.0, 0.0, 70.0, 0.0, 0.0, 0.0), temps: 30.0, tech: "", depot: D_AUCUN, cote: false, elec: 0.0, constructible: true },
    BatDef { id: "banque", nom: "Place financière", icone: "building-columns", categorie: "Économie",
        desc: "+8 % de crédits par niveau.",
        cout: r(600.0, 0.0, 100.0, 0.0, 0.0, 10.0), temps: 60.0, tech: "eco_banque", depot: D_AUCUN, cote: false, elec: -3.0, constructible: true },
    BatDef { id: "hopital", nom: "Hôpital", icone: "hospital", categorie: "Économie",
        desc: "+15 % de croissance démographique par niveau et +30 k habitants de capacité.",
        cout: r(280.0, 30.0, 80.0, 0.0, 0.0, 0.0), temps: 45.0, tech: "eco_sante", depot: D_AUCUN, cote: false, elec: -4.0, constructible: true },
    BatDef { id: "caserne", nom: "Caserne", icone: "person-military-rifle", categorie: "Militaire",
        desc: "Forme l'infanterie et les forces spéciales. Chaque niveau accélère l'entraînement de 25 %.",
        cout: r(200.0, 40.0, 80.0, 0.0, 0.0, 0.0), temps: 35.0, tech: "", depot: D_AUCUN, cote: false, elec: -2.0, constructible: true },
    BatDef { id: "usine_blindes", nom: "Usine de blindés", icone: "truck-monster", categorie: "Militaire",
        desc: "Produit véhicules blindés, chars, artillerie et DCA mobile.",
        cout: r(500.0, 0.0, 260.0, 40.0, 0.0, 0.0), temps: 70.0, tech: "mil_blindes", depot: D_AUCUN, cote: false, elec: -10.0, constructible: true },
    BatDef { id: "aeroport", nom: "Base aérienne", icone: "plane-departure", categorie: "Militaire",
        desc: "Produit et abrite les avions ; point de départ des missions aériennes.",
        cout: r(700.0, 0.0, 300.0, 120.0, 0.0, 10.0), temps: 90.0, tech: "mil_aviation", depot: D_AUCUN, cote: false, elec: -10.0, constructible: true },
    BatDef { id: "port", nom: "Chantier naval", icone: "anchor", categorie: "Militaire",
        desc: "Construit la flotte. Doit être bâti sur une côte.",
        cout: r(600.0, 0.0, 320.0, 60.0, 0.0, 0.0), temps: 80.0, tech: "mil_marine", depot: D_AUCUN, cote: true, elec: -8.0, constructible: true },
    BatDef { id: "silo", nom: "Silo à missiles", icone: "rocket", categorie: "Militaire",
        desc: "Assemble et lance les missiles de croisière, balistiques et nucléaires.",
        cout: r(1200.0, 0.0, 500.0, 100.0, 0.0, 40.0), temps: 120.0, tech: "mil_missiles", depot: D_AUCUN, cote: false, elec: -12.0, constructible: true },
    BatDef { id: "defense_aa", nom: "Batterie sol-air", icone: "crosshairs", categorie: "Défense",
        desc: "Abat les avions dans un rayon de 2 cases et intercepte les missiles dans un rayon de 3 cases.",
        cout: r(450.0, 0.0, 200.0, 20.0, 0.0, 15.0), temps: 55.0, tech: "mil_dca", depot: D_AUCUN, cote: false, elec: -6.0, constructible: true },
    BatDef { id: "fort", nom: "Fortifications", icone: "chess-rook", categorie: "Défense",
        desc: "+30 % de défense par niveau pour les troupes sur la case, et ralentit les assaillants.",
        cout: r(250.0, 0.0, 180.0, 0.0, 0.0, 0.0), temps: 45.0, tech: "", depot: D_AUCUN, cote: false, elec: 0.0, constructible: true },
    BatDef { id: "radar", nom: "Station radar", icone: "satellite-dish", categorie: "Défense",
        desc: "Vision dans un rayon de 3 + niveau. Détecte les unités furtives.",
        cout: r(380.0, 0.0, 120.0, 0.0, 0.0, 20.0), temps: 50.0, tech: "mil_radar", depot: D_AUCUN, cote: false, elec: -5.0, constructible: true },
];

pub fn bat(id: &str) -> Option<&'static BatDef> {
    BATIMENTS.iter().find(|b| b.id == id)
}

// ── Unites ────────────────────────────────────────────────────────
pub const DOM_TERRE: &str = "terre";
pub const DOM_AIR: &str = "air";
pub const DOM_MER: &str = "mer";
pub const DOM_MISSILE: &str = "missile";

#[derive(Serialize)]
pub struct UniteDef {
    pub id: &'static str,
    pub nom: &'static str,
    pub icone: &'static str,
    pub domaine: &'static str,
    pub desc: &'static str,
    pub att_sol: f64,
    pub att_air: f64,
    pub att_mer: f64,
    pub defense: f64,
    pub pv: f64,
    /// Cases par minute (avions : vitesse de mission).
    pub vitesse: f64,
    /// Portee de bombardement / rayon d'action / portee missile (cases).
    pub portee: f64,
    pub cout: Res,
    /// Entretien par minute : credits, nourriture, et un ancien entretien en
    /// petrole, desormais paye en credits (x6).
    pub entretien: [f64; 3],
    pub temps: f64,
    pub batiment: &'static str,
    pub tech: &'static str,
    pub furtif: bool,
    pub puissance: f64,
}

pub const UNITES: &[UniteDef] = &[
    UniteDef { id: "infanterie", nom: "Infanterie", icone: "person-rifle", domaine: DOM_TERRE,
        desc: "Troupes polyvalentes, peu coûteuses, solides en défense.",
        att_sol: 10.0, att_air: 2.0, att_mer: 0.0, defense: 14.0, pv: 100.0, vitesse: 3.0, portee: 0.0,
        cout: r(60.0, 20.0, 5.0, 0.0, 0.0, 0.0), entretien: [0.4, 0.3, 0.0], temps: 12.0,
        batiment: "caserne", tech: "", furtif: false, puissance: 1.0 },
    UniteDef { id: "forces_speciales", nom: "Forces spéciales", icone: "user-secret", domaine: DOM_TERRE,
        desc: "Unités d'élite furtives : invisibles sans radar, redoutables en attaque.",
        att_sol: 26.0, att_air: 4.0, att_mer: 0.0, defense: 16.0, pv: 110.0, vitesse: 4.5, portee: 0.0,
        cout: r(180.0, 30.0, 20.0, 0.0, 0.0, 5.0), entretien: [1.2, 0.4, 0.0], temps: 30.0,
        batiment: "caserne", tech: "mil_forces_speciales", furtif: true, puissance: 3.0 },
    UniteDef { id: "blinde_leger", nom: "Véhicule blindé", icone: "truck-field", domaine: DOM_TERRE,
        desc: "Rapide et bien protégé, idéal pour exploiter une percée.",
        att_sol: 18.0, att_air: 3.0, att_mer: 0.0, defense: 18.0, pv: 160.0, vitesse: 6.0, portee: 0.0,
        cout: r(140.0, 0.0, 45.0, 10.0, 0.0, 0.0), entretien: [0.8, 0.0, 0.3], temps: 20.0,
        batiment: "usine_blindes", tech: "mil_blindes", furtif: false, puissance: 2.4 },
    UniteDef { id: "char", nom: "Char de combat", icone: "tank", domaine: DOM_TERRE,
        desc: "Le fer de lance des offensives terrestres.",
        att_sol: 36.0, att_air: 2.0, att_mer: 0.0, defense: 32.0, pv: 280.0, vitesse: 4.0, portee: 0.0,
        cout: r(320.0, 0.0, 120.0, 25.0, 0.0, 0.0), entretien: [1.6, 0.0, 0.8], temps: 32.0,
        batiment: "usine_blindes", tech: "mil_blindes_lourds", furtif: false, puissance: 5.5 },
    UniteDef { id: "artillerie", nom: "Artillerie", icone: "bomb", domaine: DOM_TERRE,
        desc: "Bombarde une case jusqu'à 2 cases de distance sans riposte. Fragile au contact.",
        att_sol: 30.0, att_air: 0.0, att_mer: 8.0, defense: 6.0, pv: 90.0, vitesse: 2.5, portee: 2.0,
        cout: r(220.0, 0.0, 80.0, 10.0, 0.0, 0.0), entretien: [1.0, 0.0, 0.3], temps: 25.0,
        batiment: "usine_blindes", tech: "mil_artillerie", furtif: false, puissance: 3.5 },
    UniteDef { id: "dca_mobile", nom: "DCA mobile", icone: "crosshairs", domaine: DOM_TERRE,
        desc: "Accompagne l'armée et abat les avions qui attaquent sa case.",
        att_sol: 6.0, att_air: 38.0, att_mer: 0.0, defense: 12.0, pv: 120.0, vitesse: 4.0, portee: 0.0,
        cout: r(200.0, 0.0, 70.0, 10.0, 0.0, 5.0), entretien: [0.9, 0.0, 0.2], temps: 22.0,
        batiment: "usine_blindes", tech: "mil_dca", furtif: false, puissance: 2.5 },
    UniteDef { id: "chasseur", nom: "Chasseur", icone: "jet-fighter", domaine: DOM_AIR,
        desc: "Supériorité aérienne : escorte les raids et intercepte les avions ennemis autour de sa base.",
        att_sol: 10.0, att_air: 42.0, att_mer: 8.0, defense: 20.0, pv: 150.0, vitesse: 30.0, portee: 9.0,
        cout: r(420.0, 0.0, 120.0, 40.0, 0.0, 10.0), entretien: [2.0, 0.0, 1.0], temps: 35.0,
        batiment: "aeroport", tech: "mil_aviation", furtif: false, puissance: 6.0 },
    UniteDef { id: "helicoptere", nom: "Hélicoptère d'attaque", icone: "helicopter", domaine: DOM_AIR,
        desc: "Appui rapproché dévastateur contre les blindés, rayon d'action court.",
        att_sol: 34.0, att_air: 6.0, att_mer: 12.0, defense: 14.0, pv: 130.0, vitesse: 18.0, portee: 5.0,
        cout: r(350.0, 0.0, 90.0, 30.0, 0.0, 5.0), entretien: [1.6, 0.0, 0.8], temps: 30.0,
        batiment: "aeroport", tech: "mil_aviation", furtif: false, puissance: 5.0 },
    UniteDef { id: "bombardier", nom: "Bombardier", icone: "plane", domaine: DOM_AIR,
        desc: "Frappes lourdes sur les troupes et les infrastructures, longue portée.",
        att_sol: 70.0, att_air: 4.0, att_mer: 30.0, defense: 18.0, pv: 220.0, vitesse: 22.0, portee: 14.0,
        cout: r(700.0, 0.0, 220.0, 80.0, 0.0, 15.0), entretien: [3.0, 0.0, 1.6], temps: 50.0,
        batiment: "aeroport", tech: "mil_bombardiers", furtif: false, puissance: 9.0 },
    UniteDef { id: "drone", nom: "Drone armé", icone: "plane-up", domaine: DOM_AIR,
        desc: "Frappes de précision bon marché, sans pilote.",
        att_sol: 22.0, att_air: 0.0, att_mer: 10.0, defense: 6.0, pv: 60.0, vitesse: 20.0, portee: 11.0,
        cout: r(160.0, 0.0, 40.0, 10.0, 0.0, 12.0), entretien: [0.6, 0.0, 0.2], temps: 18.0,
        batiment: "aeroport", tech: "mil_drones", furtif: false, puissance: 2.5 },
    UniteDef { id: "fregate", nom: "Frégate", icone: "ship", domaine: DOM_MER,
        desc: "Navire d'escorte polyvalent, efficace contre les avions.",
        att_sol: 8.0, att_air: 22.0, att_mer: 26.0, defense: 22.0, pv: 320.0, vitesse: 5.0, portee: 0.0,
        cout: r(480.0, 0.0, 200.0, 40.0, 0.0, 0.0), entretien: [2.0, 0.2, 0.8], temps: 40.0,
        batiment: "port", tech: "mil_marine", furtif: false, puissance: 6.0 },
    UniteDef { id: "destroyer", nom: "Destroyer", icone: "ship", domaine: DOM_MER,
        desc: "Puissant navire de ligne, bombarde les côtes à 2 cases.",
        att_sol: 26.0, att_air: 18.0, att_mer: 44.0, defense: 30.0, pv: 520.0, vitesse: 5.5, portee: 2.0,
        cout: r(800.0, 0.0, 360.0, 70.0, 0.0, 10.0), entretien: [3.0, 0.3, 1.4], temps: 60.0,
        batiment: "port", tech: "mil_marine_lourde", furtif: false, puissance: 10.0 },
    UniteDef { id: "sous_marin", nom: "Sous-marin", icone: "water", domaine: DOM_MER,
        desc: "Chasseur furtif des mers : invisible sans radar, dévastateur contre les navires.",
        att_sol: 0.0, att_air: 0.0, att_mer: 60.0, defense: 20.0, pv: 300.0, vitesse: 4.5, portee: 0.0,
        cout: r(750.0, 0.0, 300.0, 40.0, 0.0, 20.0), entretien: [2.6, 0.2, 0.6], temps: 55.0,
        batiment: "port", tech: "mil_marine_lourde", furtif: true, puissance: 9.0 },
    UniteDef { id: "porte_avions", nom: "Porte-avions", icone: "anchor", domaine: DOM_MER,
        desc: "Base aérienne flottante : bombarde jusqu'à 3 cases et protège la flotte.",
        att_sol: 40.0, att_air: 40.0, att_mer: 30.0, defense: 45.0, pv: 1200.0, vitesse: 4.0, portee: 3.0,
        cout: r(2400.0, 0.0, 900.0, 200.0, 0.0, 60.0), entretien: [8.0, 0.8, 3.0], temps: 150.0,
        batiment: "port", tech: "mil_porte_avions", furtif: false, puissance: 30.0 },
    UniteDef { id: "missile_croisiere", nom: "Missile de croisière", icone: "rocket", domaine: DOM_MISSILE,
        desc: "Frappe de précision à 12 cases : détruit des troupes et endommage un bâtiment.",
        att_sol: 450.0, att_air: 0.0, att_mer: 450.0, defense: 0.0, pv: 1.0, vitesse: 20.0, portee: 12.0,
        cout: r(600.0, 0.0, 150.0, 60.0, 0.0, 20.0), entretien: [0.5, 0.0, 0.0], temps: 45.0,
        batiment: "silo", tech: "mil_missiles", furtif: false, puissance: 4.0 },
    UniteDef { id: "missile_balistique", nom: "Missile balistique", icone: "rocket", domaine: DOM_MISSILE,
        desc: "Portée de 30 cases, charge lourde : ravage une case entière.",
        att_sol: 1000.0, att_air: 0.0, att_mer: 1000.0, defense: 0.0, pv: 1.0, vitesse: 40.0, portee: 30.0,
        cout: r(1400.0, 0.0, 400.0, 120.0, 5.0, 40.0), entretien: [1.0, 0.0, 0.0], temps: 90.0,
        batiment: "silo", tech: "mil_balistique", furtif: false, puissance: 10.0 },
    UniteDef { id: "missile_nucleaire", nom: "Missile nucléaire", icone: "radiation", domaine: DOM_MISSILE,
        desc: "Porte une charge nucléaire : uranium enrichi ou plutonium (avec des explosifs de mise à feu), ou des ogives nucléaires et des bombes H fabriquées. Plus la charge est grosse, plus le rayon est grand, sans limite : de quoi raser toute la carte. Le cœur de l'explosion devient une terre neutre et irradiée.",
        att_sol: 15000.0, att_air: 0.0, att_mer: 15000.0, defense: 0.0, pv: 1.0, vitesse: 45.0, portee: 999.0,
        cout: r(5000.0, 0.0, 1200.0, 300.0, 0.0, 120.0), entretien: [4.0, 0.0, 0.0], temps: 240.0,
        batiment: "silo", tech: "mil_nucleaire", furtif: false, puissance: 60.0 },
];

pub fn unite(id: &str) -> Option<&'static UniteDef> {
    UNITES.iter().find(|u| u.id == id)
}

// ── Technologies ──────────────────────────────────────────────────
#[derive(Serialize)]
pub struct TechDef {
    pub id: &'static str,
    pub nom: &'static str,
    pub branche: &'static str,
    pub icone: &'static str,
    pub desc: &'static str,
    pub cout: f64,
    pub prereq: &'static [&'static str],
    /// Rang dans la branche (colonne d'affichage de l'arbre).
    pub rang: u8,
}

pub const BRANCHES: [(&str, &str, &str, &str); 4] = [
    ("militaire", "Militaire", "shield-halved", "#dc2626"),
    ("economie", "Économie", "chart-line", "#f59e0b"),
    ("diplomatie", "Diplomatie", "handshake", "#3b82f6"),
    ("industrie", "Industrie", "industry", "#4fa553"),
];

pub const TECHS: &[TechDef] = &[
    // ── Militaire ──
    TechDef { id: "mil_blindes", nom: "Mécanisation", branche: "militaire", icone: "truck-field", rang: 2,
        desc: "Débloque l'usine de blindés et le véhicule blindé.", cout: 160.0, prereq: &[] },
    TechDef { id: "mil_marine", nom: "Marine de guerre", branche: "militaire", icone: "anchor", rang: 2,
        desc: "Débloque le chantier naval et la frégate.", cout: 180.0, prereq: &[] },
    TechDef { id: "mil_artillerie", nom: "Artillerie moderne", branche: "militaire", icone: "bomb", rang: 3,
        desc: "Débloque l'artillerie à longue portée.", cout: 260.0, prereq: &[] },
    TechDef { id: "mil_blindes_lourds", nom: "Chars de combat", branche: "militaire", icone: "tank", rang: 3,
        desc: "Débloque le char de combat principal.", cout: 340.0, prereq: &[] },
    TechDef { id: "mil_aviation", nom: "Aviation militaire", branche: "militaire", icone: "jet-fighter", rang: 3,
        desc: "Débloque la base aérienne, le chasseur et l'hélicoptère.", cout: 380.0, prereq: &[] },
    TechDef { id: "mil_amphibie", nom: "Opérations amphibies", branche: "militaire", icone: "water", rang: 3,
        desc: "Les troupes terrestres peuvent traverser la mer (à vitesse réduite) si vous possédez un chantier naval.", cout: 300.0, prereq: &[] },
    TechDef { id: "mil_marine_lourde", nom: "Flotte de haute mer", branche: "militaire", icone: "ship", rang: 4,
        desc: "Débloque le destroyer et le sous-marin.", cout: 520.0, prereq: &[] },
    TechDef { id: "mil_bombardiers", nom: "Bombardement stratégique", branche: "militaire", icone: "plane", rang: 4,
        desc: "Débloque le bombardier lourd.", cout: 560.0, prereq: &[] },
    TechDef { id: "mil_dca", nom: "Défense antiaérienne", branche: "militaire", icone: "crosshairs", rang: 4,
        desc: "Débloque la batterie sol-air et la DCA mobile.", cout: 420.0, prereq: &[] },
    TechDef { id: "mil_forces_speciales", nom: "Forces spéciales", branche: "militaire", icone: "user-secret", rang: 4,
        desc: "Débloque les forces spéciales furtives.", cout: 450.0, prereq: &[] },
    TechDef { id: "mil_radar", nom: "Détection radar", branche: "militaire", icone: "satellite-dish", rang: 4,
        desc: "Débloque la station radar (vision étendue, détection des furtifs).", cout: 400.0, prereq: &[] },
    TechDef { id: "mil_drones", nom: "Drones armés", branche: "militaire", icone: "plane-up", rang: 5,
        desc: "Débloque le drone armé.", cout: 620.0, prereq: &[] },
    TechDef { id: "mil_porte_avions", nom: "Groupe aéronaval", branche: "militaire", icone: "anchor", rang: 5,
        desc: "Débloque le porte-avions.", cout: 900.0, prereq: &[] },
    TechDef { id: "mil_missiles", nom: "Missiles de croisière", branche: "militaire", icone: "rocket", rang: 5,
        desc: "Débloque le silo à missiles et le missile de croisière.", cout: 800.0, prereq: &[] },
    TechDef { id: "mil_bouclier", nom: "Bouclier antimissile", branche: "militaire", icone: "shield-halved", rang: 6,
        desc: "Les batteries sol-air peuvent intercepter tous les missiles, y compris nucléaires.", cout: 1100.0, prereq: &[] },
    TechDef { id: "mil_balistique", nom: "Missiles balistiques", branche: "militaire", icone: "rocket", rang: 6,
        desc: "Débloque le missile balistique à longue portée.", cout: 1200.0, prereq: &[] },
    TechDef { id: "mil_nucleaire", nom: "Dissuasion nucléaire", branche: "militaire", icone: "radiation", rang: 7,
        desc: "Débloque le missile nucléaire. Son emploi ruine votre réputation.", cout: 2500.0, prereq: &[] },

    // ── Economie ──
    TechDef { id: "eco_commerce", nom: "Commerce international", branche: "economie", icone: "scale-balanced", rang: 2,
        desc: "Frais du marché mondial divisés par deux.", cout: 160.0, prereq: &[] },
    TechDef { id: "eco_banque", nom: "Système bancaire", branche: "economie", icone: "building-columns", rang: 3,
        desc: "Débloque la place financière.", cout: 260.0, prereq: &[] },
    TechDef { id: "eco_sante", nom: "Santé publique", branche: "economie", icone: "hospital", rang: 3,
        desc: "Débloque l'hôpital.", cout: 240.0, prereq: &[] },
    TechDef { id: "eco_energies", nom: "Énergies renouvelables", branche: "economie", icone: "solar-panel", rang: 4,
        desc: "Débloque le parc solaire.", cout: 340.0, prereq: &[] },
    TechDef { id: "eco_mondialisation", nom: "Mondialisation", branche: "economie", icone: "globe", rang: 5,
        desc: "+20 % sur les ventes au marché mondial, frais nuls.", cout: 800.0, prereq: &[] },
    TechDef { id: "eco_etat_providence", nom: "État-providence", branche: "economie", icone: "people-group", rang: 5,
        desc: "+20 % de croissance démographique et +10 % d'impôts.", cout: 700.0, prereq: &[] },

    // ── Diplomatie ──
    TechDef { id: "dip_ambassades", nom: "Réseau d'ambassades", branche: "diplomatie", icone: "handshake", rang: 2,
        desc: "Débloque l'ambassade.", cout: 150.0, prereq: &[] },
    TechDef { id: "dip_alliances", nom: "Traités d'alliance", branche: "diplomatie", icone: "flag", rang: 2,
        desc: "Permet de fonder un bloc d'alliance.", cout: 180.0, prereq: &[] },
    TechDef { id: "dip_renseignement", nom: "Renseignement", branche: "diplomatie", icone: "binoculars", rang: 3,
        desc: "+1 de vision et composition exacte des armées étrangères visibles.", cout: 260.0, prereq: &[] },
    TechDef { id: "dip_traites", nom: "Droit international", branche: "diplomatie", icone: "scale-balanced", rang: 3,
        desc: "Pactes de non-agression doublés en durée, +1 influence/min.", cout: 280.0, prereq: &[] },
    TechDef { id: "dip_espionnage", nom: "Services secrets", branche: "diplomatie", icone: "user-secret", rang: 4,
        desc: "Débloque les opérations d'espionnage : sabotage, vol technologique, déstabilisation.", cout: 480.0, prereq: &[] },
    TechDef { id: "dip_onu", nom: "Siège international", branche: "diplomatie", icone: "building-un", rang: 5,
        desc: "+400 troupes maximum et +5 influence/min.", cout: 900.0, prereq: &[] },

    // ── Industrie ──
    TechDef { id: "ind_extraction", nom: "Extraction avancée", branche: "industrie", icone: "oil-well", rang: 2,
        desc: "+25 % de minerai commun.", cout: 190.0, prereq: &[] },
    TechDef { id: "ind_electronique", nom: "Électronique", branche: "industrie", icone: "microchip", rang: 3,
        desc: "+10 % de recherche, débloque l'extracteur de terres rares.", cout: 300.0, prereq: &[] },
    TechDef { id: "ind_nucleaire_civil", nom: "Nucléaire civil", branche: "industrie", icone: "atom", rang: 4,
        desc: "Centrales nucléaires sûres : plus aucun risque d'accident à leur mise en service.", cout: 600.0, prereq: &[] },
    TechDef { id: "ind_grands_travaux", nom: "Grands travaux", branche: "industrie", icone: "helmet-safety", rang: 5,
        desc: "Niveau maximal des bâtiments porté de 5 à 8.", cout: 750.0, prereq: &[] },
];

pub fn tech(id: &str) -> Option<&'static TechDef> {
    TECHS.iter().find(|t| t.id == id)
}

// ── Ameliorations : bonus a niveaux, sans prerequis ─────────────────
// Recherchees comme les technologies (identifiant « am:<id> ») ; chaque
// niveau coute `cout * 1.5^niveau_actuel` points.
#[derive(Serialize)]
pub struct AmelioDef {
    pub id: &'static str,
    pub nom: &'static str,
    pub branche: &'static str,
    pub icone: &'static str,
    /// Effet d'UN niveau.
    pub desc: &'static str,
    pub cout: f64,
    pub max: u8,
}

pub const AMELIORATIONS: &[AmelioDef] = &[
    AmelioDef { id: "armement", nom: "Armement", branche: "militaire", icone: "crosshairs", desc: "+5 % d'attaque des unités terrestres", cout: 60.0, max: 10 },
    AmelioDef { id: "robotique", nom: "Chaînes de production", branche: "militaire", icone: "screwdriver-wrench", desc: "+7 % de vitesse de production des unités", cout: 80.0, max: 10 },
    AmelioDef { id: "logistique", nom: "Logistique", branche: "militaire", icone: "truck", desc: "-4 % d'entretien des unités", cout: 70.0, max: 10 },
    AmelioDef { id: "fiscalite", nom: "Fiscalité", branche: "economie", icone: "coins", desc: "+5 % de crédits", cout: 60.0, max: 10 },
    AmelioDef { id: "agronomie", nom: "Agronomie", branche: "economie", icone: "wheat-awn", desc: "+5 % de population maximale", cout: 50.0, max: 10 },
    AmelioDef { id: "urbanisme", nom: "Urbanisme", branche: "economie", icone: "city", desc: "+6 % de population dans les villes", cout: 70.0, max: 10 },
    AmelioDef { id: "administration", nom: "Administration", branche: "diplomatie", icone: "map-location-dot", desc: "+80 troupes maximum par niveau", cout: 60.0, max: 10 },
    AmelioDef { id: "rayonnement", nom: "Rayonnement", branche: "diplomatie", icone: "bullhorn", desc: "+6 % d'influence, annexions 5 % moins chères", cout: 70.0, max: 10 },
    AmelioDef { id: "productivite", nom: "Productivité", branche: "industrie", icone: "gears", desc: "+6 % de vitesse de construction", cout: 60.0, max: 10 },
    AmelioDef { id: "siderurgie", nom: "Sidérurgie", branche: "industrie", icone: "fire-flame-curved", desc: "-3 % de métal sur tous les coûts", cout: 70.0, max: 10 },
    AmelioDef { id: "stockage", nom: "Stockage", branche: "industrie", icone: "warehouse", desc: "+12 % de capacité de stockage", cout: 50.0, max: 10 },
    AmelioDef { id: "sciences", nom: "Sciences", branche: "industrie", icone: "microscope", desc: "+8 % de recherche", cout: 80.0, max: 10 },
];

pub fn amelioration(id: &str) -> Option<&'static AmelioDef> {
    AMELIORATIONS.iter().find(|a| a.id == id)
}

// ── Specialisations nationales ────────────────────────────────────
#[derive(Serialize)]
pub struct SpeDef {
    pub id: &'static str,
    pub nom: &'static str,
    pub icone: &'static str,
    pub desc: &'static str,
}

pub const SPECIALISATIONS: &[SpeDef] = &[
    SpeDef { id: "industrielle", nom: "Puissance industrielle", icone: "industry",
        desc: "+15 % de vitesse de construction, -10 % de métal sur les coûts." },
    SpeDef { id: "commerciale", nom: "Nation marchande", icone: "coins",
        desc: "+15 % de crédits, frais du marché divisés par deux." },
    SpeDef { id: "militaire", nom: "Tradition militaire", icone: "shield-halved",
        desc: "+10 % d'attaque, -15 % de coût des unités." },
    SpeDef { id: "diplomatique", nom: "Vocation diplomatique", icone: "handshake",
        desc: "+30 % d'influence, +160 troupes maximum." },
    SpeDef { id: "scientifique", nom: "Élite scientifique", icone: "flask",
        desc: "Laboratoires deux fois plus inventifs, plans 20 % moins chers au marché." },
    SpeDef { id: "agricole", nom: "Grenier du monde", icone: "wheat-awn",
        desc: "+40 % de croissance démographique." },
    SpeDef { id: "miniere", nom: "Nation minière", icone: "helmet-safety",
        desc: "+20 % de tous les minerais." },
    SpeDef { id: "energetique", nom: "Puissance énergétique", icone: "bolt",
        desc: "+30 % d'électricité produite, centrales thermiques 25 % plus sobres." },
    SpeDef { id: "batisseuse", nom: "Empire bâtisseur", icone: "map-location-dot",
        desc: "Expansion en terres neutres 25 % moins coûteuse en troupes, +120 troupes maximum." },
    SpeDef { id: "forteresse", nom: "Nation forteresse", icone: "chess-rook",
        desc: "+25 % de défense dans vos provinces, fortifications 30 % moins chères." },
];

pub fn specialisation(id: &str) -> Option<&'static SpeDef> {
    SPECIALISATIONS.iter().find(|s| s.id == id)
}

/// Palette proposee a la creation d'un pays (le client peut aussi
/// envoyer n'importe quelle couleur #rrggbb).
pub const COULEURS_PAYS: &[&str] = &[
    "#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00", "#00acc1", "#d81b60",
    "#6d4c41", "#3949ab", "#7cb342", "#f4511e", "#5e35b1", "#00897b", "#c0ca33", "#546e7a",
];

/// Emblemes proposes (icones du jeu d'icones VEX).
pub const EMBLEMES: &[&str] = &[
    "star", "crown", "shield-halved", "dove", "sun", "moon", "fire-flame-curved", "bolt",
    "anchor", "tree", "mountain", "feather", "chess-knight", "chess-rook", "dragon", "crow",
    "globe", "gem", "leaf", "snowflake", "skull", "hammer", "wheat-awn", "atom",
];
