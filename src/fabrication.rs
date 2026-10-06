// ══════════════════════════════════════════════════════════════════
// fabrication.rs — Minerais, elements, raffinerie, fabrique
//
//   Minerais (4 types)        extraits par les carrieres et les mines
//     commun     : fer, aluminium, cuivre... (partout)
//     rare       : terres rares, metaux precieux (en quantite limitee)
//     radioactif : uranium, thorium, plutonium...
//     legendaire : elements superlourds, qui ne durent pas dans la
//                  realite : ils se desintegrent aussi dans le jeu
//   Raffinerie   minerai -> l'un des 118 elements du tableau periodique,
//                ou -> metal / terres rares / uranium (ressources de base)
//   Fabrique     recettes de plus en plus complexes selon son niveau,
//                jusqu'au trou noir (niveau 8)
//
// Tout est stocke dans Pays.stock (id -> quantite). Les ids des elements
// sont leurs symboles chimiques (« Fe », « Og »), ceux des minerais
// « minerai_* », ceux des produits en minuscules (« acier »).
// ══════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ── Minerais ──────────────────────────────────────────────────────
pub const COMMUN: u8 = 1;
pub const RARE: u8 = 2;
pub const RADIOACTIF: u8 = 3;
pub const LEGENDAIRE: u8 = 4;

#[derive(Serialize)]
pub struct MineraiDef {
    pub id: &'static str,
    pub nom: &'static str,
    pub categorie: u8,
    pub icone: &'static str,
    pub couleur: &'static str,
    pub desc: &'static str,
}

pub const MINERAIS: [MineraiDef; 4] = [
    MineraiDef { id: "minerai_commun", nom: "Minerai commun", categorie: COMMUN, icone: "mountain", couleur: "#94a3b8",
        desc: "Roche ordinaire : fer, aluminium, cuivre, silicium… On en trouve partout." },
    MineraiDef { id: "minerai_rare", nom: "Minerai rare", categorie: RARE, icone: "gem", couleur: "#a855f7",
        desc: "Terres rares et métaux précieux, en quantité limitée : seulement sur les gisements de terres rares." },
    MineraiDef { id: "minerai_radioactif", nom: "Minerai radioactif", categorie: RADIOACTIF, icone: "radiation", couleur: "#22c55e",
        desc: "Uranium, thorium, radium… Seulement sur les gisements d'uranium." },
    MineraiDef { id: "minerai_legendaire", nom: "Minerai légendaire", categorie: LEGENDAIRE, icone: "meteor", couleur: "#f43f5e",
        desc: "Fragments de météorite d'où l'on tire les éléments superlourds. Introuvable ailleurs que dans les cratères." },
];

pub fn minerai_de(categorie: u8) -> &'static str {
    MINERAIS.iter().find(|m| m.categorie == categorie).map(|m| m.id).unwrap_or("minerai_commun")
}

// ── Elements ──────────────────────────────────────────────────────
#[derive(Serialize)]
pub struct ElementDef {
    pub z: u8,
    pub id: &'static str,
    pub nom: &'static str,
    pub categorie: u8,
}

const fn e(z: u8, id: &'static str, nom: &'static str, categorie: u8) -> ElementDef {
    ElementDef { z, id, nom, categorie }
}

pub const ELEMENTS: [ElementDef; 118] = [
    e(1, "H", "Hydrogène", COMMUN), e(2, "He", "Hélium", COMMUN), e(3, "Li", "Lithium", COMMUN),
    e(4, "Be", "Béryllium", RARE), e(5, "B", "Bore", COMMUN), e(6, "C", "Carbone", COMMUN),
    e(7, "N", "Azote", COMMUN), e(8, "O", "Oxygène", COMMUN), e(9, "F", "Fluor", COMMUN),
    e(10, "Ne", "Néon", COMMUN), e(11, "Na", "Sodium", COMMUN), e(12, "Mg", "Magnésium", COMMUN),
    e(13, "Al", "Aluminium", COMMUN), e(14, "Si", "Silicium", COMMUN), e(15, "P", "Phosphore", COMMUN),
    e(16, "S", "Soufre", COMMUN), e(17, "Cl", "Chlore", COMMUN), e(18, "Ar", "Argon", COMMUN),
    e(19, "K", "Potassium", COMMUN), e(20, "Ca", "Calcium", COMMUN), e(21, "Sc", "Scandium", RARE),
    e(22, "Ti", "Titane", COMMUN), e(23, "V", "Vanadium", COMMUN), e(24, "Cr", "Chrome", COMMUN),
    e(25, "Mn", "Manganèse", COMMUN), e(26, "Fe", "Fer", COMMUN), e(27, "Co", "Cobalt", COMMUN),
    e(28, "Ni", "Nickel", COMMUN), e(29, "Cu", "Cuivre", COMMUN), e(30, "Zn", "Zinc", COMMUN),
    e(31, "Ga", "Gallium", RARE), e(32, "Ge", "Germanium", RARE), e(33, "As", "Arsenic", RARE),
    e(34, "Se", "Sélénium", RARE), e(35, "Br", "Brome", RARE), e(36, "Kr", "Krypton", RARE),
    e(37, "Rb", "Rubidium", RARE), e(38, "Sr", "Strontium", COMMUN), e(39, "Y", "Yttrium", RARE),
    e(40, "Zr", "Zirconium", COMMUN), e(41, "Nb", "Niobium", RARE), e(42, "Mo", "Molybdène", RARE),
    e(43, "Tc", "Technétium", RADIOACTIF), e(44, "Ru", "Ruthénium", RARE), e(45, "Rh", "Rhodium", RARE),
    e(46, "Pd", "Palladium", RARE), e(47, "Ag", "Argent", RARE), e(48, "Cd", "Cadmium", RARE),
    e(49, "In", "Indium", RARE), e(50, "Sn", "Étain", COMMUN), e(51, "Sb", "Antimoine", RARE),
    e(52, "Te", "Tellure", RARE), e(53, "I", "Iode", RARE), e(54, "Xe", "Xénon", RARE),
    e(55, "Cs", "Césium", RARE), e(56, "Ba", "Baryum", COMMUN), e(57, "La", "Lanthane", RARE),
    e(58, "Ce", "Cérium", RARE), e(59, "Pr", "Praséodyme", RARE), e(60, "Nd", "Néodyme", RARE),
    e(61, "Pm", "Prométhium", RADIOACTIF), e(62, "Sm", "Samarium", RARE), e(63, "Eu", "Europium", RARE),
    e(64, "Gd", "Gadolinium", RARE), e(65, "Tb", "Terbium", RARE), e(66, "Dy", "Dysprosium", RARE),
    e(67, "Ho", "Holmium", RARE), e(68, "Er", "Erbium", RARE), e(69, "Tm", "Thulium", RARE),
    e(70, "Yb", "Ytterbium", RARE), e(71, "Lu", "Lutécium", RARE), e(72, "Hf", "Hafnium", RARE),
    e(73, "Ta", "Tantale", RARE), e(74, "W", "Tungstène", RARE), e(75, "Re", "Rhénium", RARE),
    e(76, "Os", "Osmium", RARE), e(77, "Ir", "Iridium", RARE), e(78, "Pt", "Platine", RARE),
    e(79, "Au", "Or", RARE), e(80, "Hg", "Mercure", RARE), e(81, "Tl", "Thallium", RARE),
    e(82, "Pb", "Plomb", COMMUN), e(83, "Bi", "Bismuth", RARE), e(84, "Po", "Polonium", RADIOACTIF),
    e(85, "At", "Astate", RADIOACTIF), e(86, "Rn", "Radon", RADIOACTIF), e(87, "Fr", "Francium", RADIOACTIF),
    e(88, "Ra", "Radium", RADIOACTIF), e(89, "Ac", "Actinium", RADIOACTIF), e(90, "Th", "Thorium", RADIOACTIF),
    e(91, "Pa", "Protactinium", RADIOACTIF), e(92, "U", "Uranium", RADIOACTIF), e(93, "Np", "Neptunium", RADIOACTIF),
    e(94, "Pu", "Plutonium", RADIOACTIF), e(95, "Am", "Américium", RADIOACTIF), e(96, "Cm", "Curium", RADIOACTIF),
    e(97, "Bk", "Berkélium", RADIOACTIF), e(98, "Cf", "Californium", RADIOACTIF), e(99, "Es", "Einsteinium", LEGENDAIRE),
    e(100, "Fm", "Fermium", LEGENDAIRE), e(101, "Md", "Mendélévium", LEGENDAIRE), e(102, "No", "Nobélium", LEGENDAIRE),
    e(103, "Lr", "Lawrencium", LEGENDAIRE), e(104, "Rf", "Rutherfordium", LEGENDAIRE), e(105, "Db", "Dubnium", LEGENDAIRE),
    e(106, "Sg", "Seaborgium", LEGENDAIRE), e(107, "Bh", "Bohrium", LEGENDAIRE), e(108, "Hs", "Hassium", LEGENDAIRE),
    e(109, "Mt", "Meitnérium", LEGENDAIRE), e(110, "Ds", "Darmstadtium", LEGENDAIRE), e(111, "Rg", "Roentgenium", LEGENDAIRE),
    e(112, "Cn", "Copernicium", LEGENDAIRE), e(113, "Nh", "Nihonium", LEGENDAIRE), e(114, "Fl", "Flérovium", LEGENDAIRE),
    e(115, "Mc", "Moscovium", LEGENDAIRE), e(116, "Lv", "Livermorium", LEGENDAIRE), e(117, "Ts", "Tennesse", LEGENDAIRE),
    e(118, "Og", "Oganesson", LEGENDAIRE),
];

pub fn element(id: &str) -> Option<&'static ElementDef> {
    ELEMENTS.iter().find(|e| e.id == id)
}

/// Minerai necessaire pour raffiner 1 unite d'un element : les elements
/// lourds de chaque famille coutent plus cher.
pub fn minerai_par_element(e: &ElementDef) -> f64 {
    let base = match e.categorie {
        COMMUN => 2.0,
        RARE => 4.0,
        RADIOACTIF => 6.0,
        _ => 8.0,
    };
    (base * (1.0 + e.z as f64 / 80.0)).round()
}

/// Demi-vie (secondes de jeu) des elements legendaires : du plus « stable »
/// (einsteinium, 1 h) au plus fugace (oganesson, 2 min).
pub fn demi_vie(e: &ElementDef) -> Option<f64> {
    (e.categorie == LEGENDAIRE).then(|| {
        let rang = (e.z - 99) as f64; // 0..19
        (3600.0 * (120.0f64 / 3600.0).powf(rang / 19.0)).round()
    })
}

fn prix_element(e: &ElementDef) -> f64 {
    let base = match e.categorie {
        COMMUN => 4.0,
        RARE => 25.0,
        RADIOACTIF => 90.0,
        _ => 600.0,
    };
    (base * (1.0 + e.z as f64 / 50.0)).round()
}

// ── Produits ──────────────────────────────────────────────────────
#[derive(Serialize)]
pub struct ProduitDef {
    pub id: &'static str,
    pub nom: &'static str,
    /// Niveau de fabrique requis (1 a 8).
    pub niveau: u8,
    pub entrees: &'static [(&'static str, f64)],
    pub sortie: f64,
    /// Secondes de fabrication, a vitesse de fabrique 1.
    pub temps: f64,
    pub icone: &'static str,
    pub desc: &'static str,
}

const fn p(
    id: &'static str, nom: &'static str, niveau: u8, entrees: &'static [(&'static str, f64)], sortie: f64,
    temps: f64, icone: &'static str, desc: &'static str,
) -> ProduitDef {
    ProduitDef { id, nom, niveau, entrees, sortie, temps, icone, desc }
}

pub const PRODUITS: &[ProduitDef] = &[
    // ── Niveau 1 : matériaux de base ──
    p("acier", "Acier", 1, &[("Fe", 2.0), ("C", 1.0)], 2.0, 10.0, "bars-staggered", "Fer et carbone : la base de toute l'industrie."),
    p("inox", "Acier inoxydable", 1, &[("Fe", 2.0), ("Cr", 1.0), ("Ni", 1.0)], 2.0, 12.0, "bars-staggered", "Acier qui ne rouille pas."),
    p("laiton", "Laiton", 1, &[("Cu", 2.0), ("Zn", 1.0)], 2.0, 8.0, "coins", "Cuivre et zinc, pour les douilles et la plomberie."),
    p("bronze", "Bronze", 1, &[("Cu", 3.0), ("Sn", 1.0)], 3.0, 8.0, "medal", "Le plus vieil alliage de l'humanité."),
    p("verre", "Verre", 1, &[("Si", 2.0), ("Na", 1.0), ("Ca", 1.0)], 3.0, 8.0, "wine-glass", "Silice fondue."),
    p("ciment", "Ciment", 1, &[("Ca", 2.0), ("Si", 1.0), ("Al", 1.0)], 3.0, 8.0, "trowel", "Liant hydraulique."),
    p("beton", "Béton", 1, &[("ciment", 1.0), ("Si", 2.0)], 3.0, 6.0, "cubes-stacked", "Ciment et granulats."),
    p("eau", "Eau pure", 1, &[("H", 2.0), ("O", 1.0)], 2.0, 4.0, "droplet", "H₂O, indispensable aux réacteurs et à la chimie."),
    p("sel", "Sel", 1, &[("Na", 1.0), ("Cl", 1.0)], 2.0, 4.0, "cubes", "Chlorure de sodium."),
    p("acide_sulfurique", "Acide sulfurique", 1, &[("S", 1.0), ("O", 4.0), ("H", 2.0)], 2.0, 10.0, "flask", "Le produit chimique le plus utilisé au monde."),
    p("ammoniac", "Ammoniac", 1, &[("N", 1.0), ("H", 3.0)], 2.0, 10.0, "flask-vial", "Base des engrais et des explosifs."),
    p("engrais", "Engrais", 1, &[("ammoniac", 1.0), ("P", 1.0), ("K", 1.0)], 3.0, 10.0, "seedling", "Azote, phosphore, potassium."),
    p("poudre_noire", "Poudre noire", 1, &[("K", 1.0), ("N", 1.0), ("S", 1.0), ("C", 1.0)], 2.0, 10.0, "fire", "Salpêtre, soufre et charbon."),
    p("cable_cuivre", "Câble de cuivre", 1, &[("Cu", 2.0)], 3.0, 6.0, "plug", "Pour transporter l'électricité."),
    p("lingot_aluminium", "Lingot d'aluminium", 1, &[("Al", 3.0)], 2.0, 8.0, "bars-staggered", "Métal léger."),
    p("plastique", "Plastique", 1, &[("C", 2.0), ("H", 4.0)], 3.0, 8.0, "bottle-water", "Polymère issu du carbone."),
    p("caoutchouc", "Caoutchouc", 1, &[("C", 3.0), ("H", 5.0)], 2.0, 8.0, "circle", "Élastomère."),
    p("carburant", "Carburant", 1, &[("C", 2.0), ("H", 6.0)], 3.0, 8.0, "gas-pump", "Hydrocarbure raffiné."),
    // ── Niveau 2 : premiers composants ──
    p("explosifs", "Explosifs", 2, &[("ammoniac", 2.0), ("acide_sulfurique", 1.0), ("C", 2.0)], 3.0, 16.0, "bomb", "Indispensables aux bombes et à la mise à feu des armes nucléaires."),
    p("munitions", "Munitions", 2, &[("laiton", 1.0), ("poudre_noire", 1.0), ("Pb", 1.0)], 4.0, 12.0, "box-archive", "Cartouches et obus légers."),
    p("tole_blindee", "Tôle blindée", 2, &[("acier", 3.0), ("Mn", 1.0)], 2.0, 16.0, "shield", "Acier au manganèse."),
    p("lingot_titane", "Lingot de titane", 2, &[("Ti", 3.0)], 2.0, 14.0, "bars-staggered", "Léger et très résistant."),
    p("alliage_aero", "Alliage aéronautique", 2, &[("lingot_aluminium", 2.0), ("lingot_titane", 1.0), ("Mg", 1.0)], 2.0, 18.0, "plane", "Pour les avions et les fusées."),
    p("moteur_thermique", "Moteur thermique", 2, &[("acier", 3.0), ("carburant", 1.0), ("caoutchouc", 1.0)], 1.0, 24.0, "gears", "Moteur à combustion."),
    p("pneu", "Pneu", 2, &[("caoutchouc", 3.0), ("acier", 1.0)], 2.0, 10.0, "circle-dot", "Pour les véhicules."),
    p("batterie", "Batterie", 2, &[("Li", 2.0), ("Co", 1.0), ("Ni", 1.0)], 2.0, 16.0, "car-battery", "Accumulateur lithium-ion."),
    p("circuit_imprime", "Circuit imprimé", 2, &[("cable_cuivre", 2.0), ("plastique", 1.0), ("Si", 1.0)], 2.0, 16.0, "microchip", "Support de toute l'électronique."),
    p("fibre_optique", "Fibre optique", 2, &[("verre", 2.0), ("Ge", 1.0)], 3.0, 14.0, "wave-square", "Transmission par la lumière."),
    p("aimant", "Aimant permanent", 2, &[("Nd", 2.0), ("Fe", 2.0), ("B", 1.0)], 2.0, 16.0, "magnet", "Aimant néodyme-fer-bore."),
    p("cellule_solaire", "Cellule solaire", 2, &[("Si", 3.0), ("Ag", 1.0), ("verre", 1.0)], 2.0, 18.0, "solar-panel", "Transforme la lumière en électricité."),
    p("medicaments", "Médicaments", 2, &[("C", 2.0), ("H", 2.0), ("N", 1.0), ("I", 1.0)], 3.0, 14.0, "pills", "Antiseptiques et traitements."),
    p("outil", "Outillage", 2, &[("acier", 2.0), ("W", 1.0)], 2.0, 14.0, "screwdriver-wrench", "Outils au carbure de tungstène."),
    p("tuyauterie", "Tuyauterie", 2, &[("inox", 2.0)], 3.0, 10.0, "faucet", "Canalisations résistantes."),
    p("supra_basique", "Supraconducteur", 2, &[("Nb", 2.0), ("Ti", 1.0)], 1.0, 20.0, "bolt", "Niobium-titane : courant sans résistance une fois refroidi."),
    p("lentille", "Lentille optique", 2, &[("verre", 2.0), ("La", 1.0)], 2.0, 12.0, "magnifying-glass", "Verre au lanthane."),
    // ── Niveau 3 : électronique et mécanique ──
    p("processeur", "Processeur", 3, &[("circuit_imprime", 2.0), ("Si", 2.0), ("Au", 1.0), ("Hf", 1.0)], 1.0, 30.0, "microchip", "Le cerveau des machines."),
    p("memoire", "Mémoire", 3, &[("circuit_imprime", 1.0), ("Si", 2.0), ("Ta", 1.0)], 2.0, 24.0, "memory", "Barrettes de mémoire."),
    p("moteur_electrique", "Moteur électrique", 3, &[("aimant", 2.0), ("cable_cuivre", 2.0), ("acier", 1.0)], 1.0, 24.0, "fan", "Silencieux et efficace."),
    p("module_radar", "Module radar", 3, &[("circuit_imprime", 2.0), ("Ga", 2.0), ("As", 1.0)], 1.0, 30.0, "satellite-dish", "Émetteur à l'arséniure de gallium."),
    p("laser", "Laser", 3, &[("lentille", 1.0), ("Y", 1.0), ("Nd", 1.0), ("batterie", 1.0)], 1.0, 30.0, "wand-sparkles", "Laser Nd:YAG."),
    p("capteur", "Capteur", 3, &[("circuit_imprime", 1.0), ("Ge", 1.0), ("In", 1.0)], 2.0, 22.0, "eye", "Infrarouge et vision nocturne."),
    p("arme_legere", "Armes légères", 3, &[("acier", 2.0), ("munitions", 2.0), ("outil", 1.0)], 3.0, 24.0, "gun", "Fusils et mitrailleuses."),
    p("propergol", "Propergol", 3, &[("lingot_aluminium", 2.0), ("Cl", 1.0), ("ammoniac", 1.0)], 2.0, 24.0, "fire-flame-simple", "Carburant solide de fusée."),
    p("drone", "Drone", 3, &[("moteur_electrique", 1.0), ("batterie", 2.0), ("capteur", 1.0), ("plastique", 2.0)], 1.0, 36.0, "helicopter-symbol", "Engin volant télépiloté."),
    p("vehicule", "Véhicule blindé", 3, &[("moteur_thermique", 1.0), ("pneu", 4.0), ("tole_blindee", 2.0)], 1.0, 40.0, "truck", "Transport de troupes."),
    p("turbine", "Turbine", 3, &[("alliage_aero", 3.0), ("inox", 2.0), ("Re", 1.0)], 1.0, 40.0, "fan", "Superalliage au rhénium."),
    p("catalyseur", "Catalyseur", 3, &[("Pt", 1.0), ("Pd", 1.0), ("Rh", 1.0)], 2.0, 30.0, "atom", "Accélère les réactions chimiques."),
    p("reservoir_h2", "Réservoir d'hydrogène", 3, &[("inox", 3.0), ("H", 6.0)], 1.0, 24.0, "gas-pump", "Hydrogène sous pression."),
    p("composite_carbone", "Composite carbone", 3, &[("C", 6.0), ("plastique", 2.0)], 2.0, 30.0, "layer-group", "Fibre de carbone et résine."),
    p("eau_lourde", "Eau lourde", 3, &[("eau", 10.0)], 1.0, 40.0, "droplet", "D₂O, modérateur des réacteurs."),
    p("barre_combustible", "Barre de combustible", 3, &[("U", 3.0), ("Zr", 2.0)], 1.0, 40.0, "bars", "Uranium gainé de zirconium."),
    // ── Niveau 4 : systèmes ──
    p("ordinateur", "Ordinateur", 4, &[("processeur", 2.0), ("memoire", 2.0), ("circuit_imprime", 2.0), ("batterie", 1.0)], 1.0, 50.0, "computer", "Calcul et commandement."),
    p("satellite", "Satellite", 4, &[("ordinateur", 1.0), ("cellule_solaire", 4.0), ("alliage_aero", 3.0), ("module_radar", 1.0)], 1.0, 80.0, "satellite", "Communications et observation."),
    p("avion", "Avion", 4, &[("turbine", 2.0), ("alliage_aero", 6.0), ("ordinateur", 1.0)], 1.0, 80.0, "plane", "Cellule et moteurs d'avion."),
    p("blindage_composite", "Blindage composite", 4, &[("tole_blindee", 2.0), ("composite_carbone", 2.0), ("W", 1.0)], 2.0, 50.0, "shield-halved", "Blindage multicouche."),
    p("robot", "Robot industriel", 4, &[("moteur_electrique", 3.0), ("ordinateur", 1.0), ("capteur", 3.0), ("acier", 4.0)], 1.0, 70.0, "robot", "Automatise les usines."),
    p("guidage", "Système de guidage", 4, &[("ordinateur", 1.0), ("capteur", 2.0), ("module_radar", 1.0)], 1.0, 60.0, "location-crosshairs", "Pour les missiles de précision."),
    p("reacteur_fusee", "Moteur-fusée", 4, &[("propergol", 3.0), ("turbine", 1.0), ("inox", 2.0)], 1.0, 70.0, "rocket", "Propulsion spatiale."),
    p("coeur_plutonium", "Cœur de plutonium", 4, &[("Pu", 3.0), ("Ga", 1.0)], 1.0, 60.0, "circle-radiation", "Plutonium stabilisé au gallium : matière fissile des bombes."),
    p("separateur", "Séparateur isotopique", 4, &[("catalyseur", 1.0), ("ordinateur", 1.0), ("supra_basique", 2.0)], 1.0, 70.0, "filter", "Trie les isotopes."),
    p("module_accelerateur", "Module d'accélérateur", 4, &[("supra_basique", 4.0), ("aimant", 4.0), ("ordinateur", 1.0)], 1.0, 80.0, "circle-nodes", "Élément d'accélérateur de particules."),
    p("pile_combustible", "Pile à combustible", 4, &[("catalyseur", 1.0), ("reservoir_h2", 1.0), ("plastique", 2.0)], 1.0, 50.0, "battery-full", "Électricité à partir d'hydrogène."),
    p("bombe", "Bombe conventionnelle", 4, &[("explosifs", 4.0), ("acier", 2.0)], 1.0, 40.0, "bomb", "Charge explosive."),
    p("obus", "Obus d'artillerie", 4, &[("explosifs", 1.0), ("laiton", 2.0), ("acier", 1.0)], 3.0, 30.0, "burst", "Munitions lourdes."),
    p("char", "Char d'assaut", 4, &[("vehicule", 1.0), ("blindage_composite", 2.0), ("arme_legere", 2.0), ("ordinateur", 1.0)], 1.0, 90.0, "truck-monster", "Blindé de combat."),
    // ── Niveau 5 : haute technologie ──
    p("supercalculateur", "Supercalculateur", 5, &[("ordinateur", 6.0), ("supra_basique", 2.0), ("He", 2.0)], 1.0, 120.0, "server", "Des millions de milliards d'opérations par seconde."),
    p("module_ia", "Module d'IA", 5, &[("supercalculateur", 1.0), ("memoire", 4.0)], 1.0, 100.0, "brain", "Intelligence artificielle."),
    p("reacteur_compact", "Réacteur nucléaire compact", 5, &[("barre_combustible", 4.0), ("eau_lourde", 3.0), ("inox", 4.0), ("Hf", 1.0)], 1.0, 140.0, "atom", "Propulsion et énergie embarquées."),
    p("ogive_nucleaire", "Ogive nucléaire", 5, &[("coeur_plutonium", 1.0), ("explosifs", 6.0), ("ordinateur", 1.0)], 1.0, 120.0, "radiation", "Bombe atomique prête à monter sur un missile."),
    p("ogive_h", "Ogive thermonucléaire", 5, &[("ogive_nucleaire", 1.0), ("Li", 4.0), ("H", 6.0)], 1.0, 150.0, "radiation", "Bombe H : la fission allume la fusion."),
    p("bouclier_antimissile", "Bouclier antimissile", 5, &[("module_radar", 4.0), ("guidage", 4.0), ("supercalculateur", 1.0)], 1.0, 140.0, "shield", "Détection et interception."),
    p("exosquelette", "Exosquelette", 5, &[("moteur_electrique", 4.0), ("composite_carbone", 3.0), ("batterie", 3.0), ("capteur", 2.0)], 1.0, 100.0, "person-rays", "Soldat augmenté."),
    p("laser_militaire", "Laser militaire", 5, &[("laser", 4.0), ("supra_basique", 2.0), ("batterie", 4.0)], 1.0, 110.0, "wand-magic-sparkles", "Arme à énergie dirigée."),
    p("satellite_espion", "Satellite espion", 5, &[("satellite", 1.0), ("capteur", 4.0), ("lentille", 4.0)], 1.0, 120.0, "satellite", "Observation haute résolution."),
    p("lanceur", "Lanceur spatial", 5, &[("reacteur_fusee", 4.0), ("alliage_aero", 10.0), ("ordinateur", 2.0)], 1.0, 160.0, "shuttle-space", "Fusée orbitale."),
    p("aimant_supra", "Aimant supraconducteur", 5, &[("supra_basique", 4.0), ("He", 3.0), ("Nb", 2.0)], 1.0, 110.0, "magnet", "Champs magnétiques extrêmes."),
    p("railgun", "Canon électromagnétique", 5, &[("aimant_supra", 2.0), ("tole_blindee", 4.0), ("batterie", 6.0)], 1.0, 130.0, "bolt-lightning", "Projectile à Mach 7."),
    p("rtg", "Générateur au plutonium", 5, &[("Pu", 1.0), ("Am", 1.0), ("inox", 2.0)], 1.0, 100.0, "battery-full", "Pile radio-isotopique."),
    // ── Niveau 6 : frontière scientifique ──
    p("sonde_spatiale", "Sonde spatiale", 6, &[("satellite", 1.0), ("rtg", 2.0), ("ordinateur", 1.0)], 1.0, 180.0, "satellite", "Exploration lointaine."),
    p("module_orbital", "Module de station orbitale", 6, &[("lanceur", 1.0), ("reacteur_compact", 1.0), ("composite_carbone", 8.0)], 1.0, 240.0, "shuttle-space", "Habitat en orbite."),
    p("module_tokamak", "Module de tokamak", 6, &[("aimant_supra", 6.0), ("supercalculateur", 1.0), ("eau_lourde", 4.0)], 1.0, 220.0, "circle-notch", "Anneau de confinement du plasma."),
    p("reacteur_fusion", "Réacteur à fusion", 6, &[("module_tokamak", 3.0), ("Li", 3.0), ("Be", 2.0)], 1.0, 300.0, "sun", "L'énergie des étoiles."),
    p("ordinateur_quantique", "Ordinateur quantique", 6, &[("supercalculateur", 2.0), ("aimant_supra", 2.0), ("He", 4.0)], 1.0, 260.0, "atom", "Qubits supraconducteurs."),
    p("metamateriau", "Métamatériau", 6, &[("composite_carbone", 4.0), ("Au", 2.0), ("Ag", 2.0), ("Ga", 2.0)], 1.0, 200.0, "shapes", "Matériau aux propriétés impossibles dans la nature."),
    p("camouflage_optique", "Camouflage optique", 6, &[("metamateriau", 3.0), ("capteur", 4.0)], 1.0, 200.0, "ghost", "Rend presque invisible."),
    p("piege_antimatiere", "Piège à antimatière", 6, &[("module_accelerateur", 4.0), ("aimant_supra", 4.0)], 1.0, 240.0, "circle-nodes", "Bouteille magnétique."),
    p("nanomachines", "Nanomachines", 6, &[("module_ia", 1.0), ("Pt", 2.0), ("Au", 2.0), ("C", 4.0)], 2.0, 220.0, "microscope", "Robots moléculaires."),
    p("graphene", "Graphène", 6, &[("C", 12.0), ("catalyseur", 1.0)], 2.0, 160.0, "border-all", "Carbone en une seule couche d'atomes."),
    p("alliage_actinide", "Alliage d'actinides", 6, &[("Am", 2.0), ("Cm", 2.0), ("Cf", 1.0), ("inox", 2.0)], 1.0, 200.0, "radiation", "Alliage radioactif très dense."),
    p("drone_autonome", "Drone autonome", 6, &[("drone", 4.0), ("module_ia", 1.0), ("laser_militaire", 1.0)], 1.0, 220.0, "robot", "Combat sans pilote."),
    // ── Niveau 7 : éléments légendaires ──
    p("ilot_stabilite", "Îlot de stabilité", 7, &[("Fl", 2.0), ("Cn", 2.0), ("aimant_supra", 2.0)], 1.0, 300.0, "life-ring", "Noyaux superlourds enfin stables."),
    p("matiere_exotique", "Matière exotique", 7, &[("Og", 1.0), ("Ts", 1.0), ("piege_antimatiere", 1.0)], 1.0, 360.0, "atom", "Matière à énergie négative."),
    p("confinement", "Confinement magnétique", 7, &[("aimant_supra", 8.0), ("reacteur_fusion", 1.0)], 1.0, 320.0, "circle-notch", "Contient l'incontenable."),
    p("antimatiere", "Antimatière", 7, &[("piege_antimatiere", 2.0), ("reacteur_fusion", 1.0)], 1.0, 400.0, "circle-half-stroke", "Un gramme vaut une bombe atomique."),
    p("moteur_antimatiere", "Moteur à antimatière", 7, &[("antimatiere", 2.0), ("confinement", 1.0)], 1.0, 400.0, "rocket", "Propulsion interstellaire."),
    p("bombe_antimatiere", "Bombe à antimatière", 7, &[("antimatiere", 3.0), ("confinement", 1.0), ("guidage", 1.0)], 1.0, 420.0, "explosion", "Annihilation totale dans un rayon de 3 cases : la terre redevient neutre (même la vôtre) et le centre se creuse en un cratère que la mer envahit."),
    p("bouclier_energie", "Bouclier d'énergie", 7, &[("reacteur_fusion", 1.0), ("metamateriau", 4.0), ("ordinateur_quantique", 1.0)], 1.0, 380.0, "shield-heart", "Champ de force."),
    p("ia_superieure", "IA supérieure", 7, &[("ordinateur_quantique", 2.0), ("nanomachines", 4.0)], 1.0, 400.0, "brain", "Pense plus vite que tous les humains réunis."),
    p("noyau_superlourd", "Noyau superlourd", 7, &[("Lv", 1.0), ("Mc", 1.0), ("Nh", 1.0), ("Rg", 1.0), ("Ds", 1.0)], 1.0, 300.0, "atom", "Assemblage d'éléments éphémères : à fabriquer vite."),
    p("distorseur", "Distorseur gravitationnel", 7, &[("matiere_exotique", 2.0), ("aimant_supra", 6.0), ("ordinateur_quantique", 1.0)], 1.0, 450.0, "hurricane", "Plie l'espace-temps."),
    // ── Niveau 8 : le trou noir ──
    p("singularite", "Singularité artificielle", 8, &[("distorseur", 2.0), ("matiere_exotique", 4.0), ("antimatiere", 4.0)], 1.0, 600.0, "circle-dot", "Un point de densité infinie."),
    p("trou_noir", "Trou noir", 8, &[("singularite", 1.0), ("noyau_superlourd", 4.0), ("reacteur_fusion", 2.0)], 1.0, 900.0, "circle", "Micro trou noir maintenu en orbite stable."),
    p("bombe_trou_noir", "Bombe à trou noir", 8, &[("trou_noir", 1.0), ("confinement", 2.0), ("ia_superieure", 1.0)], 1.0, 900.0, "circle", "L'arme finale : avale tout dans un rayon de 3 cases (même votre territoire) et laisse une zone morte où plus rien ne vit ni ne se construit."),
    p("moteur_distorsion", "Moteur à distorsion", 8, &[("trou_noir", 1.0), ("moteur_antimatiere", 2.0)], 1.0, 800.0, "shuttle-space", "Voyager plus vite que la lumière."),
    p("point_zero", "Générateur du point zéro", 8, &[("singularite", 1.0), ("bouclier_energie", 2.0)], 1.0, 800.0, "infinity", "Énergie tirée du vide."),
];


// ── Produits supplementaires (utiles en jeu grace a leurs effets) ──
pub const PRODUITS_EN_PLUS: &[ProduitDef] = &[
    p("brique", "Briques", 1, &[("Si", 2.0), ("Al", 1.0)], 4.0, 6.0, "cubes", "Pour bâtir plus vite."),
    p("papier", "Papier", 1, &[("C", 2.0), ("H", 1.0), ("O", 1.0)], 4.0, 5.0, "scroll", "Administration et cartes d'état-major."),
    p("savon", "Savon", 1, &[("Na", 1.0), ("C", 1.0), ("O", 1.0)], 3.0, 5.0, "soap", "Hygiène : la population grandit mieux."),
    p("colle", "Colle", 1, &[("C", 2.0), ("N", 1.0)], 3.0, 5.0, "droplet", "Liant pour les composites."),
    p("peinture", "Peinture", 1, &[("Ti", 1.0), ("C", 1.0), ("O", 1.0)], 3.0, 6.0, "paint-roller", "Protège les bâtiments."),
    p("casque", "Casques", 2, &[("acier", 1.0), ("plastique", 1.0)], 2.0, 10.0, "helmet-safety", "Protège vos soldats."),
    p("radio", "Radios", 2, &[("circuit_imprime", 1.0), ("cable_cuivre", 1.0)], 2.0, 12.0, "tower-broadcast", "Coordonne les offensives."),
    p("vaccin", "Vaccins", 2, &[("medicaments", 1.0), ("verre", 1.0)], 2.0, 14.0, "syringe", "La population grandit plus vite."),
    p("panneau_solaire", "Panneau solaire", 2, &[("cellule_solaire", 4.0), ("lingot_aluminium", 2.0)], 1.0, 20.0, "solar-panel", "De l'électricité gratuite."),
    p("gilet", "Gilets pare-balles", 2, &[("plastique", 2.0), ("tole_blindee", 1.0)], 2.0, 14.0, "shirt", "Vos défenseurs tiennent mieux."),
    p("vision_nocturne", "Lunettes de vision nocturne", 3, &[("capteur", 1.0), ("lentille", 2.0)], 1.0, 24.0, "glasses", "Attaquer de nuit."),
    p("mitrailleuse", "Mitrailleuses", 3, &[("arme_legere", 2.0), ("munitions", 4.0)], 1.0, 26.0, "gun", "Puissance de feu."),
    p("mine_terrestre", "Mines terrestres", 3, &[("explosifs", 1.0), ("acier", 1.0)], 3.0, 20.0, "land-mine-on", "Ralentit les envahisseurs."),
    p("eolienne", "Éolienne", 3, &[("composite_carbone", 2.0), ("moteur_electrique", 1.0), ("acier", 3.0)], 1.0, 36.0, "fan", "Électricité du vent."),
    p("hopital_mobile", "Hôpital mobile", 3, &[("medicaments", 4.0), ("vehicule", 1.0)], 1.0, 40.0, "truck-medical", "Soigne la population."),
    p("artillerie", "Pièces d'artillerie", 4, &[("obus", 4.0), ("vehicule", 1.0), ("acier", 4.0)], 1.0, 60.0, "burst", "Écrase les défenses."),
    p("antichar", "Missiles antichars", 4, &[("guidage", 1.0), ("explosifs", 2.0)], 2.0, 50.0, "crosshairs", "Arrête les blindés."),
    p("serveur", "Serveurs", 4, &[("ordinateur", 4.0), ("tuyauterie", 2.0)], 1.0, 60.0, "server", "Économie numérique : plus de crédits."),
    p("centrale_solaire", "Centrale solaire", 4, &[("panneau_solaire", 6.0), ("ordinateur", 1.0)], 1.0, 80.0, "solar-panel", "Beaucoup d'électricité."),
    p("usine_auto", "Chaîne automatisée", 4, &[("robot", 4.0), ("ordinateur", 2.0)], 1.0, 90.0, "industry", "Construit tout plus vite."),
    p("helicoptere", "Hélicoptère de combat", 5, &[("turbine", 2.0), ("composite_carbone", 4.0), ("arme_legere", 2.0)], 1.0, 120.0, "helicopter", "Appui aérien des offensives."),
    p("radar_lointain", "Radar longue portée", 5, &[("module_radar", 4.0), ("supercalculateur", 1.0)], 1.0, 120.0, "satellite-dish", "Voit venir les missiles."),
    p("bunker", "Bunker", 5, &[("beton", 20.0), ("tole_blindee", 6.0)], 1.0, 100.0, "shield", "Défense en profondeur."),
    p("constellation", "Constellation de satellites", 5, &[("satellite", 4.0), ("lanceur", 1.0)], 1.0, 200.0, "satellite", "Internet mondial : beaucoup de crédits."),
    p("chasseur_furtif", "Chasseur furtif", 6, &[("avion", 1.0), ("camouflage_optique", 1.0), ("laser_militaire", 1.0)], 1.0, 240.0, "jet-fighter", "Frappe sans être vu."),
    p("cyberarme", "Cyberarme", 6, &[("module_ia", 2.0), ("ordinateur_quantique", 1.0)], 1.0, 260.0, "bug", "Vole les secrets technologiques."),
    p("hyperloop", "Hyperloop", 6, &[("aimant_supra", 6.0), ("beton", 20.0)], 1.0, 260.0, "train-subway", "Les chantiers vont beaucoup plus vite."),
    p("clinique_genetique", "Clinique génétique", 6, &[("nanomachines", 2.0), ("medicaments", 10.0)], 1.0, 260.0, "dna", "Population plus nombreuse et en meilleure santé."),
    p("armure_nanotech", "Armure nanotech", 7, &[("nanomachines", 4.0), ("exosquelette", 1.0), ("graphene", 2.0)], 1.0, 360.0, "user-shield", "Défenseurs presque invulnérables."),
    p("androide", "Soldats androïdes", 7, &[("ia_superieure", 1.0), ("exosquelette", 2.0), ("laser_militaire", 1.0)], 2.0, 420.0, "robot", "Une armée qui ne se fatigue jamais."),
    p("ascenseur_spatial", "Ascenseur spatial", 7, &[("graphene", 20.0), ("module_orbital", 2.0)], 1.0, 500.0, "shuttle-space", "Commerce spatial : énormément de crédits."),
    p("sphere_dyson", "Essaim de Dyson", 8, &[("point_zero", 1.0), ("module_orbital", 4.0)], 1.0, 1200.0, "sun", "Capte l'énergie du soleil."),
    p("portail", "Portail dimensionnel", 8, &[("trou_noir", 1.0), ("distorseur", 2.0)], 1.0, 1200.0, "circle-nodes", "Fait surgir des renforts de nulle part."),
];

// ── Effets des produits en stock ──────────────────────────────────
// Posseder des produits donne des bonus permanents (tant qu'on les garde).
// Chaque unite apporte `par_unite`, plafonne a `max` pour ce produit.
pub struct Effet {
    pub produit: &'static str,
    pub effet: &'static str,
    pub par_unite: f64,
    pub max: f64,
}

const fn ef(produit: &'static str, effet: &'static str, par_unite: f64, max: f64) -> Effet {
    Effet { produit, effet, par_unite, max }
}

/// attaque : pertes reduites en envahissant ; defense : l'envahisseur perd
/// plus ; troupes : maximum de troupes ; construction : vitesse des
/// chantiers ; electricite : production (valeur absolue) ; croissance :
/// population ; invention : laboratoires ; interception : missiles abattus
/// (chance absolue) ; credits : revenus. Tout en fraction (0,01 = 1 %).
pub const EFFETS: &[Effet] = &[
    ef("arme_legere", "attaque", 0.005, 0.20), ef("mitrailleuse", "attaque", 0.01, 0.20), ef("radio", "attaque", 0.003, 0.10),
    ef("vision_nocturne", "attaque", 0.01, 0.15), ef("char", "attaque", 0.02, 0.25), ef("artillerie", "attaque", 0.02, 0.20),
    ef("drone_autonome", "attaque", 0.03, 0.30), ef("helicoptere", "attaque", 0.03, 0.24), ef("chasseur_furtif", "attaque", 0.05, 0.30),
    ef("railgun", "attaque", 0.02, 0.20), ef("laser_militaire", "attaque", 0.02, 0.20),
    ef("casque", "defense", 0.003, 0.10), ef("gilet", "defense", 0.005, 0.15), ef("mine_terrestre", "defense", 0.005, 0.20),
    ef("blindage_composite", "defense", 0.01, 0.25), ef("antichar", "defense", 0.02, 0.20), ef("exosquelette", "defense", 0.02, 0.30),
    ef("bunker", "defense", 0.04, 0.32), ef("armure_nanotech", "defense", 0.06, 0.36), ef("bouclier_energie", "defense", 0.10, 0.60),
    ef("munitions", "troupes", 0.002, 0.15), ef("vehicule", "troupes", 0.01, 0.20), ef("androide", "troupes", 0.05, 0.40),
    ef("portail", "troupes", 0.25, 0.50),
    ef("brique", "construction", 0.002, 0.10), ef("outil", "construction", 0.005, 0.15), ef("robot", "construction", 0.03, 0.45),
    ef("usine_auto", "construction", 0.06, 0.30), ef("nanomachines", "construction", 0.05, 0.40), ef("hyperloop", "construction", 0.10, 0.30),
    ef("cellule_solaire", "electricite", 3.0, 300.0), ef("panneau_solaire", "electricite", 20.0, 400.0), ef("pile_combustible", "electricite", 15.0, 300.0),
    ef("eolienne", "electricite", 30.0, 600.0), ef("rtg", "electricite", 10.0, 200.0), ef("reacteur_compact", "electricite", 60.0, 1200.0),
    ef("centrale_solaire", "electricite", 150.0, 1500.0), ef("reacteur_fusion", "electricite", 400.0, 4000.0),
    ef("point_zero", "electricite", 3000.0, 30000.0), ef("sphere_dyson", "electricite", 20000.0, 40000.0),
    ef("savon", "croissance", 0.002, 0.10), ef("engrais", "croissance", 0.003, 0.15), ef("medicaments", "croissance", 0.01, 0.30),
    ef("vaccin", "croissance", 0.02, 0.20), ef("hopital_mobile", "croissance", 0.03, 0.15), ef("clinique_genetique", "croissance", 0.08, 0.40),
    ef("ordinateur", "invention", 0.02, 0.30), ef("supercalculateur", "invention", 0.10, 1.00), ef("cyberarme", "invention", 0.20, 1.00),
    ef("ordinateur_quantique", "invention", 0.25, 1.50), ef("ia_superieure", "invention", 0.50, 2.00),
    ef("module_radar", "interception", 0.01, 0.10), ef("radar_lointain", "interception", 0.05, 0.30), ef("bouclier_antimissile", "interception", 0.10, 0.60),
    ef("papier", "credits", 0.001, 0.05), ef("fibre_optique", "credits", 0.002, 0.10), ef("serveur", "credits", 0.01, 0.15),
    ef("satellite", "credits", 0.02, 0.20), ef("module_orbital", "credits", 0.05, 0.25), ef("constellation", "credits", 0.05, 0.25),
    ef("ascenseur_spatial", "credits", 0.10, 0.30),
];


// ── Troisieme vague de recettes (objectif 200+) ──────────────────
pub const PRODUITS_VAGUE3: &[ProduitDef] = &[
    p("fibre_synthetique", "Fibre synthétique", 1, &[("C", 2.0), ("H", 2.0), ("N", 1.0)], 3.0, 6.0, "lines-leaning", "Cordes, tissus, filets."),
    p("lubrifiant", "Lubrifiant", 1, &[("C", 2.0), ("H", 4.0), ("S", 1.0)], 3.0, 6.0, "oil-can", "Les machines tournent mieux."),
    p("charbon_actif", "Charbon actif", 1, &[("C", 3.0)], 2.0, 5.0, "fire", "Filtre l'eau et l'air."),
    p("chaux", "Chaux", 1, &[("Ca", 1.0), ("O", 1.0)], 2.0, 5.0, "mortar-pestle", "Mortiers et enduits."),
    p("soude", "Soude", 1, &[("Na", 1.0), ("O", 1.0), ("H", 1.0)], 2.0, 6.0, "flask", "Base de la chimie."),
    p("verre_trempe", "Verre trempé", 1, &[("verre", 2.0)], 1.0, 8.0, "square", "Vitrages résistants."),
    p("fil_de_fer", "Fil de fer", 1, &[("Fe", 1.0)], 3.0, 4.0, "wave-square", "Clôtures et attaches."),
    p("clous", "Clous", 1, &[("Fe", 1.0)], 6.0, 4.0, "thumbtack", "Charpentes et caisses."),
    p("tuile", "Tuiles", 1, &[("Si", 1.0), ("Al", 1.0), ("O", 1.0)], 3.0, 5.0, "house-chimney", "Couvre les bâtiments."),
    p("pigment", "Pigment", 1, &[("Fe", 1.0), ("O", 2.0)], 2.0, 5.0, "palette", "Couleurs minérales."),
    p("rails", "Rails", 2, &[("acier", 4.0)], 2.0, 14.0, "train", "Le chemin de fer accélère les chantiers."),
    p("conserves", "Conserves", 2, &[("inox", 1.0), ("sel", 1.0)], 4.0, 10.0, "jar", "Réserves pour la population."),
    p("pompe", "Pompe", 2, &[("inox", 2.0), ("moteur_thermique", 1.0)], 1.0, 18.0, "faucet-drip", "Irrigation et mines."),
    p("isolant", "Isolant", 2, &[("fibre_synthetique", 2.0), ("verre", 1.0)], 2.0, 10.0, "layer-group", "Bâtiments plus sobres."),
    p("charpente", "Charpente métallique", 2, &[("acier", 3.0), ("clous", 4.0)], 2.0, 14.0, "building", "Construire plus haut, plus vite."),
    p("lampe", "Lampes", 2, &[("verre", 1.0), ("cable_cuivre", 1.0)], 3.0, 8.0, "lightbulb", "Éclairage."),
    p("groupe_electrogene", "Groupe électrogène", 2, &[("moteur_thermique", 1.0), ("cable_cuivre", 2.0), ("carburant", 2.0)], 1.0, 20.0, "plug-circle-bolt", "Un peu d'électricité partout."),
    p("jumelles", "Jumelles", 2, &[("lentille", 2.0), ("laiton", 1.0)], 1.0, 12.0, "binoculars", "Repérer l'ennemi."),
    p("trousse_secours", "Trousses de secours", 2, &[("medicaments", 2.0), ("fibre_synthetique", 1.0)], 2.0, 10.0, "kit-medical", "Soins de base."),
    p("barbele", "Barbelés", 2, &[("fil_de_fer", 4.0)], 3.0, 8.0, "xmarks-lines", "Ralentit les assaillants."),
    p("camion", "Camion", 3, &[("moteur_thermique", 1.0), ("pneu", 6.0), ("acier", 4.0)], 1.0, 30.0, "truck", "Logistique des armées."),
    p("tracteur", "Tracteur", 3, &[("moteur_thermique", 1.0), ("pneu", 4.0), ("acier", 3.0)], 1.0, 28.0, "tractor", "Agriculture mécanisée."),
    p("grue", "Grue", 3, &[("acier", 6.0), ("moteur_electrique", 2.0), ("fibre_synthetique", 2.0)], 1.0, 36.0, "building-flag", "Les chantiers vont plus vite."),
    p("telephone", "Téléphones", 3, &[("circuit_imprime", 1.0), ("batterie", 1.0), ("verre", 1.0)], 2.0, 20.0, "mobile-screen", "Commerce et communication."),
    p("imprimante_3d", "Imprimante 3D", 3, &[("moteur_electrique", 2.0), ("processeur", 1.0), ("plastique", 4.0)], 1.0, 40.0, "print", "Pièces fabriquées sur place."),
    p("turbine_hydro", "Turbine hydroélectrique", 3, &[("turbine", 1.0), ("beton", 10.0)], 1.0, 50.0, "water", "Électricité des barrages."),
    p("missile_sol_air", "Missiles sol-air", 3, &[("propergol", 2.0), ("capteur", 1.0), ("explosifs", 1.0)], 2.0, 34.0, "rocket", "Abat les missiles."),
    p("drone_sous_marin", "Drone sous-marin", 3, &[("drone", 1.0), ("batterie", 2.0), ("tole_blindee", 2.0)], 1.0, 40.0, "ship", "Reconnaissance des côtes."),
    p("fusee_eclairante", "Fusées éclairantes", 3, &[("poudre_noire", 2.0), ("Mg", 1.0)], 4.0, 16.0, "fire-flame-simple", "Pas d'attaque surprise la nuit."),
    p("pont_mobile", "Pont mobile", 3, &[("acier", 8.0), ("moteur_electrique", 1.0)], 1.0, 40.0, "bridge", "Franchir les rivières en attaque."),
    p("centre_donnees", "Centre de données", 4, &[("serveur", 4.0), ("beton", 10.0)], 1.0, 90.0, "database", "Économie numérique."),
    p("train_blinde", "Train blindé", 4, &[("vehicule", 2.0), ("tole_blindee", 8.0), ("rails", 6.0)], 1.0, 90.0, "train", "Transporte des troupes en masse."),
    p("batterie_reseau", "Batterie de réseau", 4, &[("batterie", 20.0), ("ordinateur", 1.0)], 1.0, 70.0, "car-battery", "Stocke l'électricité."),
    p("labo_mobile", "Laboratoire mobile", 4, &[("ordinateur", 1.0), ("capteur", 4.0), ("vehicule", 1.0)], 1.0, 70.0, "flask-vial", "Les chercheurs vont sur le terrain."),
    p("alerte_precoce", "Système d'alerte précoce", 4, &[("module_radar", 2.0), ("ordinateur", 1.0)], 1.0, 70.0, "tower-broadcast", "Prévient les frappes."),
    p("kit_chirurgical", "Kit chirurgical", 4, &[("inox", 2.0), ("medicaments", 4.0), ("laser", 1.0)], 1.0, 60.0, "user-doctor", "Chirurgie de pointe."),
    p("lance_roquettes", "Lance-roquettes", 4, &[("propergol", 4.0), ("vehicule", 1.0), ("guidage", 1.0)], 1.0, 80.0, "burst", "Saturation du front."),
    p("drone_cargo", "Drone cargo", 4, &[("drone", 2.0), ("moteur_electrique", 2.0)], 1.0, 60.0, "box", "Livre les chantiers par les airs."),
    p("brouilleur", "Brouilleur", 4, &[("module_radar", 1.0), ("processeur", 2.0)], 1.0, 60.0, "tower-cell", "Désorganise les attaquants."),
    p("sous_marin", "Sous-marin nucléaire", 5, &[("reacteur_compact", 1.0), ("tole_blindee", 10.0), ("capteur", 4.0)], 1.0, 180.0, "ship", "Frappe depuis les profondeurs."),
    p("satellite_meteo", "Satellite météo", 5, &[("satellite", 1.0), ("capteur", 2.0)], 1.0, 120.0, "cloud-sun", "Récoltes mieux protégées."),
    p("centrale_geothermique", "Centrale géothermique", 5, &[("turbine", 2.0), ("tuyauterie", 10.0), ("ordinateur", 1.0)], 1.0, 160.0, "temperature-high", "Chaleur de la Terre."),
    p("robot_soldat", "Robots soldats", 5, &[("robot", 2.0), ("arme_legere", 4.0), ("module_ia", 1.0)], 1.0, 150.0, "robot", "Renforcent l'armée."),
    p("missile_hypersonique", "Missile hypersonique", 5, &[("reacteur_fusee", 1.0), ("guidage", 2.0), ("explosifs", 4.0)], 1.0, 150.0, "rocket", "Impossible à arrêter."),
    p("dome_defense", "Dôme de défense", 5, &[("bouclier_antimissile", 1.0), ("beton", 20.0)], 1.0, 160.0, "umbrella", "Protège les villes des missiles."),
    p("banque_genes", "Banque de gènes", 5, &[("supercalculateur", 1.0), ("medicaments", 10.0)], 1.0, 140.0, "dna", "Santé publique avancée."),
    p("fonderie_auto", "Fonderie automatisée", 5, &[("robot", 4.0), ("turbine", 1.0)], 1.0, 140.0, "industry", "Industrie lourde sans ouvriers."),
    p("ville_intelligente", "Ville intelligente", 6, &[("module_ia", 2.0), ("cellule_solaire", 20.0), ("beton", 40.0)], 1.0, 300.0, "city", "Gestion optimale : plus de crédits."),
    p("reacteur_thorium", "Réacteur au thorium", 6, &[("Th", 10.0), ("eau_lourde", 4.0), ("inox", 6.0)], 1.0, 280.0, "atom", "Nucléaire sûr et abondant."),
    p("char_furtif", "Char furtif", 6, &[("char", 1.0), ("camouflage_optique", 1.0)], 1.0, 260.0, "truck-monster", "Percée invisible."),
    p("regenerateur", "Régénérateur cellulaire", 6, &[("nanomachines", 2.0), ("medicaments", 6.0)], 1.0, 260.0, "heart-pulse", "Répare les corps."),
    p("bouclier_orbital", "Bouclier orbital", 6, &[("satellite", 4.0), ("laser_militaire", 4.0)], 1.0, 320.0, "satellite", "Abat les missiles depuis l'espace."),
    p("labo_orbital", "Laboratoire orbital", 6, &[("module_orbital", 1.0), ("supercalculateur", 1.0)], 1.0, 300.0, "shuttle-space", "Recherche en apesanteur."),
    p("forteresse_volante", "Forteresse volante", 6, &[("avion", 2.0), ("blindage_composite", 6.0), ("railgun", 1.0)], 1.0, 320.0, "plane", "Veille au-dessus de vos frontières."),
    p("cerveau_planetaire", "Cerveau planétaire", 7, &[("ia_superieure", 2.0), ("ordinateur_quantique", 4.0)], 1.0, 600.0, "brain", "Invente sans relâche."),
    p("mur_energetique", "Mur énergétique", 7, &[("bouclier_energie", 2.0), ("confinement", 1.0)], 1.0, 500.0, "shield-heart", "Frontières presque infranchissables."),
    p("clones", "Clones", 7, &[("clinique_genetique", 1.0), ("ilot_stabilite", 1.0)], 2.0, 500.0, "people-group", "Une armée qui se multiplie."),
    p("moteur_fusion", "Moteur à fusion", 7, &[("reacteur_fusion", 1.0), ("reacteur_fusee", 2.0)], 1.0, 500.0, "rocket", "Transport ultra-rapide des chantiers."),
    p("station_antimatiere", "Centrale à antimatière", 7, &[("antimatiere", 1.0), ("confinement", 1.0)], 1.0, 600.0, "circle-half-stroke", "Énergie colossale."),
    p("flotte_stellaire", "Flotte stellaire", 8, &[("moteur_distorsion", 1.0), ("module_orbital", 6.0)], 1.0, 1500.0, "shuttle-space", "Frappe depuis l'orbite."),
    p("terraformeur", "Terraformeur", 8, &[("singularite", 1.0), ("nanomachines", 20.0)], 1.0, 1500.0, "earth-europe", "Rend chaque terre fertile."),
    p("ia_divine", "IA omnisciente", 8, &[("ia_superieure", 4.0), ("trou_noir", 1.0)], 1.0, 1500.0, "eye", "Gère l'économie mieux que personne."),
];

pub const EFFETS_VAGUE3: &[Effet] = &[
    ef("rails", "construction", 0.004, 0.12), ef("charpente", "construction", 0.005, 0.15), ef("grue", "construction", 0.02, 0.20),
    ef("imprimante_3d", "construction", 0.015, 0.15), ef("drone_cargo", "construction", 0.01, 0.10), ef("fonderie_auto", "construction", 0.04, 0.24),
    ef("moteur_fusion", "construction", 0.08, 0.24),
    ef("conserves", "croissance", 0.002, 0.10), ef("trousse_secours", "croissance", 0.005, 0.10), ef("tracteur", "croissance", 0.01, 0.15),
    ef("kit_chirurgical", "croissance", 0.01, 0.20), ef("satellite_meteo", "croissance", 0.02, 0.10), ef("banque_genes", "croissance", 0.04, 0.20),
    ef("regenerateur", "croissance", 0.06, 0.30), ef("terraformeur", "croissance", 0.30, 0.60),
    ef("groupe_electrogene", "electricite", 8.0, 160.0), ef("turbine_hydro", "electricite", 50.0, 500.0), ef("batterie_reseau", "electricite", 80.0, 800.0),
    ef("centrale_geothermique", "electricite", 250.0, 1500.0), ef("reacteur_thorium", "electricite", 600.0, 3000.0), ef("station_antimatiere", "electricite", 5000.0, 15000.0),
    ef("jumelles", "attaque", 0.003, 0.06), ef("drone_sous_marin", "attaque", 0.01, 0.10), ef("pont_mobile", "attaque", 0.01, 0.10),
    ef("lance_roquettes", "attaque", 0.02, 0.20), ef("sous_marin", "attaque", 0.04, 0.24), ef("missile_hypersonique", "attaque", 0.03, 0.21),
    ef("char_furtif", "attaque", 0.05, 0.25), ef("flotte_stellaire", "attaque", 0.20, 0.40),
    ef("barbele", "defense", 0.003, 0.12), ef("fusee_eclairante", "defense", 0.002, 0.06), ef("brouilleur", "defense", 0.01, 0.15),
    ef("forteresse_volante", "defense", 0.05, 0.30), ef("mur_energetique", "defense", 0.15, 0.45),
    ef("camion", "troupes", 0.005, 0.10), ef("train_blinde", "troupes", 0.02, 0.20), ef("robot_soldat", "troupes", 0.03, 0.30), ef("clones", "troupes", 0.08, 0.40),
    ef("missile_sol_air", "interception", 0.01, 0.15), ef("alerte_precoce", "interception", 0.02, 0.20), ef("dome_defense", "interception", 0.08, 0.32),
    ef("bouclier_orbital", "interception", 0.15, 0.45),
    ef("telephone", "credits", 0.002, 0.10), ef("centre_donnees", "credits", 0.02, 0.20), ef("ville_intelligente", "credits", 0.06, 0.30),
    ef("ia_divine", "credits", 0.30, 0.60),
    ef("labo_mobile", "invention", 0.05, 0.30), ef("labo_orbital", "invention", 0.30, 0.90), ef("cerveau_planetaire", "invention", 0.80, 1.60),
];

/// Bonus total d'un effet, d'apres ce que le pays a en stock.
pub fn effet(stock: &Stock, nom: &str) -> f64 {
    tous_effets().filter(|e| e.effet == nom).map(|e| (qte(stock, e.produit) * e.par_unite).min(e.max)).sum()
}

pub fn tous_effets() -> impl Iterator<Item = &'static Effet> {
    EFFETS.iter().chain(EFFETS_VAGUE3.iter())
}

/// Libelle d'un effet pour les joueurs.
pub fn texte_effet(e: &Effet) -> String {
    let pct = |x: f64| format!("{} %", (x * 1000.0).round() / 10.0).replace('.', ",");
    match e.effet {
        "attaque" => format!("−{} de pertes en attaque par unité (max −{})", pct(e.par_unite), pct(e.max)),
        "defense" => format!("+{} de pertes pour qui vous envahit, par unité (max +{})", pct(e.par_unite), pct(e.max)),
        "troupes" => format!("+{} de troupes maximum par unité (max +{})", pct(e.par_unite), pct(e.max)),
        "construction" => format!("+{} de vitesse de construction par unité (max +{})", pct(e.par_unite), pct(e.max)),
        "electricite" => format!("+{} d'électricité par unité (max +{})", e.par_unite, e.max),
        "croissance" => format!("+{} de croissance de la population par unité (max +{})", pct(e.par_unite), pct(e.max)),
        "invention" => format!("+{} d'inventions des laboratoires par unité (max +{})", pct(e.par_unite), pct(e.max)),
        "interception" => format!("+{} de chances d'abattre un missile par unité (max +{})", pct(e.par_unite), pct(e.max)),
        _ => format!("+{} de crédits par unité (max +{})", pct(e.par_unite), pct(e.max)),
    }
}

pub fn effet_de(produit: &str) -> Option<&'static Effet> {
    tous_effets().find(|e| e.produit == produit)
}

/// Toutes les recettes (de base + supplementaires).
pub fn tous_produits() -> impl Iterator<Item = &'static ProduitDef> {
    PRODUITS.iter().chain(PRODUITS_EN_PLUS.iter()).chain(PRODUITS_VAGUE3.iter())
}

pub fn produit(id: &str) -> Option<&'static ProduitDef> {
    tous_produits().find(|p| p.id == id)
}

/// Nom affichable de n'importe quel objet du stock.
pub fn nom_objet(id: &str) -> String {
    if let Some(e) = element(id) {
        return e.nom.to_string();
    }
    if let Some(m) = MINERAIS.iter().find(|m| m.id == id) {
        return m.nom.to_string();
    }
    produit(id).map(|p| p.nom.to_string()).unwrap_or_else(|| id.to_string())
}

/// Prix de rachat (credits) d'un objet : elements a leur prix, produits a
/// la valeur de leurs entrees + 40 % (+ le temps de fabrication).
pub fn prix_objet(id: &str) -> f64 {
    if let Some(e) = element(id) {
        return prix_element(e);
    }
    if let Some(m) = MINERAIS.iter().find(|m| m.id == id) {
        return [0.0, 4.0, 32.0, 28.0, 120.0][m.categorie as usize];
    }
    let Some(p) = produit(id) else { return 0.0 };
    let entrees: f64 = p.entrees.iter().map(|(i, q)| prix_objet(i) * q).sum();
    ((entrees * 1.4 + p.temps * 0.5) / p.sortie).round()
}

// ── Commandes de fabrication ──────────────────────────────────────
/// Ligne de raffinage (`raffinerie`) ou de fabrication (`fabrique`). Les
/// lignes d'un atelier tournent en parallele (une par niveau d'atelier).
/// Une ligne automatique recommence toute seule tant qu'il y a des matieres,
/// jusqu'a `cible` en stock (0 = sans limite).
#[derive(Serialize, Deserialize, Clone)]
pub struct Fabrication {
    pub id: u32,
    pub atelier: String,
    /// Element ou produit.
    pub objet: String,
    /// Lot : quantite raffinee, ou nombre de recettes assemblees d'un coup.
    pub qte: u32,
    pub reste: f64,
    pub total: f64,
    #[serde(default)]
    pub auto: bool,
    #[serde(default)]
    pub cible: f64,
    /// Matieres du lot deja prelevees.
    #[serde(default = "vrai")]
    pub paye: bool,
}

fn vrai() -> bool {
    true
}

/// Les minerais sont des ressources de base (Pays.res) : index de chacun.
pub fn index_minerai(id: &str) -> Option<usize> {
    use crate::defs::{LE, ME, TR, UR};
    match id {
        "minerai_commun" => Some(ME),
        "minerai_legendaire" => Some(LE),
        "minerai_radioactif" => Some(UR),
        "minerai_rare" => Some(TR),
        _ => None,
    }
}

/// Quantite possedee : minerais dans les ressources, le reste dans le stock.
pub fn possede(p: &crate::monde::Pays, id: &str) -> f64 {
    match index_minerai(id) {
        Some(i) => p.res[i],
        None => qte(&p.stock, id),
    }
}

/// Retire `n` (ou rend, si n est negatif) un objet ou un minerai.
pub fn retirer(p: &mut crate::monde::Pays, id: &str, n: f64) {
    match index_minerai(id) {
        Some(i) => p.res[i] = (p.res[i] - n).max(0.0),
        None => ajouter(&mut p.stock, id, -n),
    }
}

/// Ce qu'il faut pour raffiner 1 unite de `objet` : (minerai, quantite, secondes).
pub fn recette_raffinage(objet: &str) -> Option<(&'static str, f64, f64)> {
    let e = element(objet)?;
    Some((minerai_de(e.categorie), minerai_par_element(e), 2.0 + e.categorie as f64 * 2.0))
}

pub type Stock = BTreeMap<String, f64>;

pub fn qte(stock: &Stock, id: &str) -> f64 {
    stock.get(id).copied().unwrap_or(0.0)
}

pub fn ajouter(stock: &mut Stock, id: &str, n: f64) {
    let v = stock.entry(id.to_string()).or_insert(0.0);
    *v += n;
    if *v <= 1e-6 {
        stock.remove(id);
    }
}

/// Desintegration des elements legendaires sur `dt` secondes de jeu.
pub fn desintegrer(stock: &mut Stock, dt: f64) {
    for e in ELEMENTS.iter().filter(|e| e.categorie == LEGENDAIRE) {
        if let (Some(v), Some(hl)) = (stock.get_mut(e.id), demi_vie(e)) {
            *v *= 0.5f64.powf(dt / hl);
            if *v < 0.01 {
                stock.remove(e.id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn tableau_periodique_complet() {
        assert_eq!(ELEMENTS.len(), 118);
        for (i, e) in ELEMENTS.iter().enumerate() {
            assert_eq!(e.z as usize, i + 1, "{} mal place", e.id);
        }
        let ids: HashSet<&str> = ELEMENTS.iter().map(|e| e.id).collect();
        assert_eq!(ids.len(), 118);
        for c in [COMMUN, RARE, RADIOACTIF, LEGENDAIRE] {
            assert!(ELEMENTS.iter().any(|e| e.categorie == c));
        }
    }

    #[test]
    fn recettes_coherentes() {
        let n = tous_produits().count();
        assert!(n >= 200, "{} recettes seulement", n);
        let mut ids = HashSet::new();
        for p in tous_produits() {
            assert!(ids.insert(p.id), "{} en double", p.id);
            assert!((1..=8).contains(&p.niveau));
            for (i, _) in p.entrees {
                let connu = element(i).is_some() || produit(i).is_some();
                assert!(connu, "{} : entree inconnue {}", p.id, i);
                // Un produit n'utilise que des produits d'un niveau inferieur ou egal.
                if let Some(q) = produit(i) {
                    assert!(q.niveau <= p.niveau, "{} (niv {}) utilise {} (niv {})", p.id, p.niveau, i, q.niveau);
                }
                assert!(element(i).is_none() || produit(i).is_none(), "{} ambigu", i);
            }
            assert!(prix_objet(p.id) > 0.0);
        }
        assert_eq!(produit("trou_noir").unwrap().niveau, 8);
        let mut avec_effet = HashSet::new();
        for e in tous_effets() {
            assert!(produit(e.produit).is_some(), "effet sur un produit inconnu : {}", e.produit);
            assert!(avec_effet.insert(e.produit), "deux effets pour {}", e.produit);
        }
    }

    #[test]
    fn effets_plafonnes() {
        let mut s = Stock::new();
        ajouter(&mut s, "robot", 100.0);
        assert!((effet(&s, "construction") - 0.45).abs() < 1e-9, "plafond du robot");
        ajouter(&mut s, "outil", 10.0);
        assert!((effet(&s, "construction") - 0.50).abs() < 1e-9);
    }

    #[test]
    fn legendaires_se_desintegrent() {
        let mut s = Stock::new();
        ajouter(&mut s, "Og", 10.0);
        ajouter(&mut s, "Es", 10.0);
        ajouter(&mut s, "Fe", 10.0);
        desintegrer(&mut s, 120.0);
        assert!((qte(&s, "Og") - 5.0).abs() < 0.01, "oganesson : demi-vie 2 min");
        assert!(qte(&s, "Es") > 9.7);
        assert_eq!(qte(&s, "Fe"), 10.0);
    }
}
