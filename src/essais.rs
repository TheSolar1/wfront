// ══════════════════════════════════════════════════════════════════
// essais.rs — Tests de bout en bout (compile seulement pour les tests)
//
// Fonde des nations comme de vrais joueurs (par jeu::commande) puis
// verifie les grandes regles : encerclements, debarquements, nucleaire,
// fabrication, dons de l'administration...
// ══════════════════════════════════════════════════════════════════
#![cfg(test)]

use crate::defs::*;
use crate::jeu::{self, Joueur, Regles};
use crate::monde::*;
use serde_json::json;

/// Identifiants des nations de test (comme d'anciens comptes « ordinateur »).
pub const BASE_ID: i64 = -2_000_000_000;

pub fn joueur(user_id: i64) -> Joueur<'static> {
    Joueur { user_id, nom: "Essai", admin: false, triche: false }
}

/// Fonde `nb` nations (ids BASE_ID, BASE_ID - 1, ...).
pub fn fonder(m: &mut Monde, nb: usize, regles: &Regles) {
    const NOMS: [&str; 4] = ["Astrée", "Kalvar", "Solmar", "Orvanie"];
    for k in 0..nb {
        let uid = BASE_ID - k as i64;
        if jeu::pays_du_joueur(m, uid).is_none() {
            let v = json!({ "action": "rejoindre", "nom": NOMS[k % 4], "couleur": COULEURS_PAYS[k % COULEURS_PAYS.len()], "spe": "industrielle" });
            jeu::commande(m, &joueur(uid), &v, regles).expect("fondation");
        }
    }
}

mod tests {
    use super::*;
    /// Sans « Nucleaire civil », une centrale finit tot ou tard par avoir
    /// un accident : centrale detruite, zone irradiee, nuage qui derive.

    #[test]
    fn accident_nucleaire_sans_technologie() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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
        assert!(m.cases[case].bat.is_none() && (m.cases[case].irradiee as f64) > m.temps);
        let depart = m.nuages[0].case;
        for _ in 0..40 { jeu::tick(&mut m, 1.0); }
        assert!(m.nuages.is_empty() || m.nuages[0].case != depart, "le nuage n'a pas bouge");
    }

    /// Une poche neutre entierement encerclee revient a la nation qui
    /// l'entoure, sauf si des troupes etrangeres s'y trouvent.

    #[test]
    fn encerclement() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 2, &regles);
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
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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

    /// Une cote qui ne touche pas le pays se prend par debarquement depuis
    /// un chantier naval, et reste acquise.

    #[test]
    fn debarquement_depuis_un_port() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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

    /// Lignes automatiques : en parallele (une par niveau), relancees seules
    /// tant qu'il y a du minerai, arretees au stock vise.

    #[test]
    fn lignes_automatiques_en_parallele() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(60, 40, 7);
        fonder(&mut m, 1, &regles);
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

    /// Plans au marche, et alliance proposee puis acceptee.

    #[test]
    fn plans_et_alliance() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 2, &regles);
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
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
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
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 2, &regles);
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
            .find(|&v| m.cases[v].proprio == Some(a) && m.cases[v].bat.is_none() && est_terre(m.cases[v].terrain) && m.cases[v].terrain != T_MONTAGNE)
            .expect("case libre");
        let r = jeu::commande(&mut m, &j, &json!({ "action": "construire", "case": case, "bat": "silo" }), &regles);
        assert!(r.is_ok(), "construire silo : {:?}", r);
        for _ in 0..400 { jeu::tick(&mut m, 1.0); }
        assert_eq!(m.cases[case].bat.as_deref(), Some("silo"), "silo non construit");
        let r = jeu::commande(&mut m, &j, &json!({ "action": "produire", "case": case, "unite": "missile_nucleaire" }), &regles);
        assert!(r.is_ok(), "produire : {:?}", r);
        for _ in 0..600 { jeu::tick(&mut m, 1.0); }
        assert_eq!(m.pays[&a].materiel.get("missile_nucleaire").copied(), Some(1), "missile nucleaire dans le materiel apres production");
        let r = jeu::commande(&mut m, &j, &json!({ "action": "guerre", "pays": b }), &regles);
        assert!(r.is_ok(), "guerre : {:?}", r);
        let cible = m.pays[&b].capitale;
        let tir = json!({ "action": "missile", "genre": "missile_nucleaire", "cible": cible, "matiere": 40 });
        let r = jeu::commande(&mut m, &j, &tir, &regles);
        assert!(r.is_err(), "sans matiere fissile ni explosifs : refuse");
        {
            let p = m.pays.get_mut(&a).unwrap();
            p.ur_enrichi = 100.0;
            p.stock.insert("explosifs".into(), 50.0);
        }
        let hab_cible = m.cases[cible].hab;
        let r = jeu::commande(&mut m, &j, &tir, &regles);
        assert!(r.is_ok(), "tir : {:?}", r);
        assert!((m.pays[&a].ur_enrichi - 60.0).abs() < 1e-6, "40 kg d'uranium consommes");
        assert_eq!(crate::fabrication::qte(&m.pays[&a].stock, "explosifs"), 50.0 - jeu::explosifs_requis(40.0));
        for _ in 0..600 { jeu::tick(&mut m, 1.0); }
        assert!(m.missiles.is_empty(), "missile toujours en vol");
        assert!((m.cases[cible].irradiee as f64) > m.temps, "cible non irradiee");
        assert!(m.cases[cible].hab < hab_cible * 0.5, "les habitants de la case touchee meurent ({} -> {})", hab_cible, m.cases[cible].hab);
        // 40 kg : rayon 2 (1 + racine(2)), donc une case a distance 2 est touchee.
        let anneau = m.rayon(cible, 2).into_iter().find(|&v| m.distance(cible, v) == 2).unwrap();
        assert!((m.cases[anneau].irradiee as f64) > m.temps);
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

    /// TVA : trop haute, les gens ne veulent plus travailler (chomage) et
    /// les recettes finissent par baisser ; un optimum existe vers 30 %.
    #[test]
    fn tva_chomage_et_recettes() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let bilan = |m: &mut Monde, t: f64| {
            jeu::commande(m, &joueur(BASE_ID), &json!({ "action": "tva", "taux": t }), &regles).unwrap();
            jeu::bilans(m)[&a].clone()
        };
        let b10 = bilan(&mut m, 0.10);
        let b20 = bilan(&mut m, 0.20);
        let b33 = bilan(&mut m, 0.33);
        let b55 = bilan(&mut m, 0.55);
        assert!(b20.recettes_tva > b10.recettes_tva * 1.9, "plus de TVA, plus de recettes");
        assert!((b20.chomage - b10.chomage).abs() < 1e-9, "pas d'effet sous 20 %");
        assert!(b33.chomage > b20.chomage + 0.2, "chomage {} -> {}", b20.chomage, b33.chomage);
        assert!(b33.recettes_tva > b20.recettes_tva, "optimum vers 30 %");
        assert!(b55.recettes_tva < b33.recettes_tva, "trop haut : les recettes baissent");
        assert!(b55.chomage > 0.6);
        assert!(jeu::commande(&mut m, &joueur(BASE_ID), &json!({ "action": "tva", "taux": 2.0 }), &regles).is_ok());
        assert!((m.pays[&a].tva - crate::demographie::TVA_MAX).abs() < 1e-9, "plafonnee");
    }

    /// Une seule armee : le materiel multiplie la force des soldats s'il a
    /// son equipage ; les anciennes armees deviennent du materiel.
    #[test]
    fn armee_unique_materiel_et_equipage() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 1, &regles);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let sans = crate::armee::forces(&m, a);
        m.pays.get_mut(&a).unwrap().troupes = 2000.0;
        m.pays.get_mut(&a).unwrap().materiel.insert("char".into(), 40);
        let f = crate::armee::forces(&m, a);
        assert!(f.attaque > sans.attaque + 0.3, "les chars renforcent l'attaque : {} -> {}", sans.attaque, f.attaque);
        assert!((f.equipe - 1.0).abs() < 1e-9, "assez de soldats pour les equipages");
        // Sans soldats, le materiel ne sert presque a rien.
        m.pays.get_mut(&a).unwrap().troupes = 20.0;
        let peu = crate::armee::forces(&m, a);
        assert!(peu.equipe < 0.2, "la plupart du materiel reste sans equipage");
        assert!(20.0 * peu.attaque < 2000.0 * f.attaque / 10.0, "force totale bien plus faible");
        // Migration : une ancienne armee rejoint le materiel.
        let id = m.nouvel_id();
        m.armees.insert(id, Armee { id, proprio: a, case: m.pays[&a].capitale, unites: [("artillerie".to_string(), 3)].into_iter().collect(),
            blessures: Default::default(), chemin: vec![], progres: 0.0, bombarde: None, assaut: None, nom: "x".into() });
        m.version = 7;
        jeu::migrer(&mut m);
        assert!(m.armees.is_empty());
        assert_eq!(m.pays[&a].materiel.get("artillerie").copied(), Some(3));
    }

    /// Raid aerien depuis la base aerienne avec les avions du materiel :
    /// ils reviennent dans le materiel, la cible perd des soldats.
    #[test]
    fn raid_aerien_depuis_le_materiel() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(84, 52, 20260925);
        fonder(&mut m, 2, &regles);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let b = jeu::pays_du_joueur(&m, BASE_ID - 1).unwrap();
        let cap_a = m.pays[&a].capitale;
        let base = m.voisins(cap_a).into_iter().find(|&v| m.cases[v].proprio == Some(a)).unwrap();
        m.cases[base].bat = Some("aeroport".into());
        m.cases[base].niv = 1;
        // Une case de B a 3 cases de la base.
        let cible = m.rayon(base, 3).into_iter().find(|&v| m.distance(v, base) == 3 && est_terre(m.cases[v].terrain) && m.cases[v].proprio.is_none()).expect("terre libre");
        m.cases[cible].proprio = Some(b);
        let ja = joueur(BASE_ID);
        assert!(jeu::commande(&mut m, &ja, &json!({ "action": "mission", "cible": cible }), &regles).is_err(), "pas d'avion, pas de guerre");
        jeu::commande(&mut m, &ja, &json!({ "action": "guerre", "pays": b }), &regles).unwrap();
        m.pays.get_mut(&a).unwrap().materiel.insert("bombardier".into(), 4);
        m.pays.get_mut(&b).unwrap().troupes = 1000.0;
        jeu::commande(&mut m, &ja, &json!({ "action": "mission", "cible": cible }), &regles).unwrap();
        assert!(m.pays[&a].materiel.get("bombardier").is_none(), "les bombardiers sont partis");
        for _ in 0..120 {
            jeu::tick(&mut m, 1.0);
        }
        assert!(m.missions.is_empty(), "escadre rentree");
        assert!(m.pays[&a].materiel.get("bombardier").copied().unwrap_or(0) >= 1, "retour au materiel");
        assert!(m.pays[&b].troupes < 1000.0, "soldats tues : {}", m.pays[&b].troupes);
    }

    /// Sauvegarde compacte : rien ne se perd a l'aller-retour, et l'ancien
    /// format (une liste d'objets) se relit toujours.
    #[test]
    fn sauvegarde_compacte_aller_retour() {
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: false, largeur_monde: 500 };
        let mut m = Monde::generer(60, 40, 7);
        fonder(&mut m, 2, &regles);
        let a = jeu::pays_du_joueur(&m, BASE_ID).unwrap();
        let i = m.pays[&a].capitale;
        m.cases[i + 1].irradiee = 1234.5;
        m.cases[i + 1].degats = 77.0;
        m.cases[i + 1].revolte = true;
        let texte = serde_json::to_string(&m).unwrap();
        let m2: Monde = serde_json::from_str(&texte).unwrap();
        assert_eq!(m2.cases.len(), m.cases.len());
        for (x, y) in m.cases.iter().zip(&m2.cases) {
            assert_eq!((x.terrain, x.depot, x.proprio, x.bat.as_deref(), x.niv, x.revolte), (y.terrain, y.depot, y.proprio, y.bat.as_deref(), y.niv, y.revolte));
            assert!((x.hab - y.hab).abs() < 1e-3 && x.irradiee == y.irradiee && x.degats == y.degats);
        }
        assert!(m2.cases[i].rev > 0, "les cases possedees seront renvoyees aux clients");
        // Ancien format.
        let mut v: serde_json::Value = serde_json::from_str(&texte).unwrap();
        v["cases"] = serde_json::to_value(m.cases.iter().map(|c| json!({"terrain": c.terrain, "depot": c.depot, "proprio": c.proprio, "bat": c.bat.as_deref(), "niv": c.niv, "irradiee": c.irradiee, "degats": c.degats, "rev": 3, "hab": c.hab})).collect::<Vec<_>>()).unwrap();
        let m3: Monde = serde_json::from_value(v).unwrap();
        assert_eq!(m3.cases[i].proprio, m.cases[i].proprio);
        assert_eq!(m3.cases[i].bat.as_deref(), Some("capitale"));
    }
}

#[cfg(test)]
mod mesure_grande_carte {
    use super::*;
    #[test]
    #[ignore]
    fn mesure() {
        let t = std::time::Instant::now();
        let mut m = Monde::generer_monde_reel(2124, 3);
        println!("generation {:?} : {} x {} = {} cases", t.elapsed(), m.largeur, m.hauteur, m.cases.len());
        let regles = Regles { protection_s: 0, vitesse: 1.0, monde_reel: true, largeur_monde: 2124 };
        let pays = pays_reels();
        for (k, code) in ["FR", "DE", "BE"].iter().enumerate() {
            let idx = pays.iter().position(|p| p.code == *code).unwrap() + 1;
            let r = jeu::commande(&mut m, &joueur(BASE_ID - k as i64), &json!({"action": "rejoindre", "pays_reel": idx, "couleur": "#ef4444", "spe": "militaire"}), &regles);
            println!("{} : {:?}", code, r.map(|_| ()).err());
        }
        let t = std::time::Instant::now();
        for _ in 0..10 { jeu::tick(&mut m, 1.0); }
        println!("tick moyen {:?}", t.elapsed() / 10);
        let t = std::time::Instant::now();
        jeu::encerclements(&mut m);
        println!("encerclements {:?}", t.elapsed());
        let bl0 = jeu::bilans(&m);
        let t = std::time::Instant::now();
        m.demo_acc = 10.0;
        crate::demographie::evoluer(&mut m, &bl0, 0.0);
        println!("demographie {:?}", t.elapsed());
        let t = std::time::Instant::now();
        m.occ_acc = 60.0;
        crate::demographie::religions(&mut m, 0.0, &mut rand::thread_rng());
        println!("religions {:?}", t.elapsed());
        let mut durees = vec![];
        for _ in 0..20 { let t = std::time::Instant::now(); jeu::tick(&mut m, 1.0); durees.push(t.elapsed().as_millis()); }
        println!("ticks {:?}", durees);
        let t = std::time::Instant::now();
        let bl = jeu::bilans(&m);
        println!("bilans {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let vis = crate::vue::visions(&m, &bl, &m.pays.keys().copied().collect());
        println!("visions {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let init = crate::vue::init(&m, "x", false, 1.0, "");
        println!("init {:?} {} Mo", t.elapsed(), init.len() / 1_000_000);
        let pid = *m.pays.keys().next().unwrap();
        let ctx = crate::vue::Contexte { m: &m, bl: &bl, vis: &vis, publics: None };
        let mut suivi = crate::vue::Suivi::default();
        let t = std::time::Instant::now();
        let e1 = crate::vue::etat(&ctx, Some(pid), &mut suivi);
        let d1 = t.elapsed();
        let t = std::time::Instant::now();
        let e2 = crate::vue::etat(&ctx, Some(pid), &mut suivi);
        println!("etat premier {:?} {} ko, suivant {:?} {} ko", d1, e1.len() / 1000, t.elapsed(), e2.len() / 1000);
        let t = std::time::Instant::now();
        let s = serde_json::to_string(&m).unwrap();
        println!("sauvegarde {:?} {} Mo", t.elapsed(), s.len() / 1_000_000);
        println!("taille Case {} octets", std::mem::size_of::<Case>());
        let fr = (pays.iter().position(|p| p.code == "FR").unwrap() + 1) as u8;
        let mut origine = std::collections::BTreeMap::new();
        for i in 0..m.cases.len() {
            if m.region(i) == fr {
                let k = m.pays_au_centre(i);
                *origine.entry(if k == 0 { "bord".to_string() } else { pays[k as usize - 1].code.clone() }).or_insert(0) += 1;
            }
        }
        println!("France : {:?}", origine);
        let jouables = (1..=pays.len()).filter(|&k| m.pays_reel_jouable(k as u8)).count();
        println!("{} pays jouables", jouables);
    }
}
