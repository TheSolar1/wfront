// ══════════════════════════════════════════════════════════════════
// vue.rs — Ce que chaque joueur a le droit de voir
// Le serveur ne diffuse jamais l'etat brut : chaque client recoit sa
// propre vue (brouillard de guerre, compositions d'armees masquees,
// canaux de chat de son bloc uniquement).
// ══════════════════════════════════════════════════════════════════

use crate::defs::*;
use crate::fabrication as fab;
use crate::jeu::{self, Bilan};
use crate::monde::*;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Ce qu'un client a deja recu (pour n'envoyer que les nouveautes).
#[derive(Default, Clone)]
pub struct Suivi {
    pub rev: u64,
    pub evt: i64,
    pub chat: u64,
    pub premier: bool,
}

pub struct Visions {
    pub vue: HashMap<u32, Vec<bool>>,
    pub radar: HashMap<u32, Vec<bool>>,
}

pub fn visions(m: &Monde, bl: &HashMap<u32, Bilan>) -> Visions {
    let n = m.cases.len();
    let mut vue: HashMap<u32, Vec<bool>> = HashMap::new();
    let mut radar: HashMap<u32, Vec<bool>> = HashMap::new();
    for p in m.pays.values().filter(|p| !p.elimine) {
        vue.insert(p.id, vec![false; n]);
        radar.insert(p.id, vec![false; n]);
    }
    let bonus = |pid: u32| -> i64 {
        if m.pays.get(&pid).map(|p| p.a("dip_renseignement")).unwrap_or(false) { 1 } else { 0 }
    };
    for (i, c) in m.cases.iter().enumerate() {
        let Some(o) = c.proprio else { continue };
        let Some(v) = vue.get_mut(&o) else { continue };
        let r = 1 + bonus(o);
        for k in m.rayon(i, r) {
            v[k] = true;
        }
        if c.bat.as_deref() == Some("radar") && c.irradiee <= m.temps {
            let rr = 3 + c.niv as i64;
            let zone = m.rayon(i, rr);
            for &k in &zone {
                v[k] = true;
            }
            if let Some(rd) = radar.get_mut(&o) {
                for k in zone {
                    rd[k] = true;
                }
            }
        }
    }
    for a in m.armees.values() {
        let Some(v) = vue.get_mut(&a.proprio) else { continue };
        let r = 1 + bonus(a.proprio) + if jeu::domaine(a) == DOM_MER { 1 } else { 0 };
        for k in m.rayon(a.case, r) {
            v[k] = true;
        }
    }
    for mi in m.missions.values() {
        let Some(v) = vue.get_mut(&mi.proprio) else { continue };
        for k in m.rayon(mi.cible, 1) {
            v[k] = true;
        }
    }
    // Les membres d'un bloc partagent leur vision et leurs radars.
    for b in m.blocs.values() {
        let mut v = vec![false; n];
        let mut r = vec![false; n];
        for id in &b.membres {
            if let Some(x) = vue.get(id) {
                for k in 0..n {
                    v[k] |= x[k];
                }
            }
            if let Some(x) = radar.get(id) {
                for k in 0..n {
                    r[k] |= x[k];
                }
            }
        }
        for id in &b.membres {
            if vue.contains_key(id) {
                vue.insert(*id, v.clone());
                radar.insert(*id, r.clone());
            }
        }
    }
    let _ = bl;
    Visions { vue, radar }
}

fn hex_bits(v: &[bool]) -> String {
    let mut s = String::with_capacity(v.len() / 4 + 1);
    for chunk in v.chunks(4) {
        let mut x = 0u8;
        for (i, b) in chunk.iter().enumerate() {
            if *b {
                x |= 1 << i;
            }
        }
        s.push(std::char::from_digit(x as u32, 16).unwrap());
    }
    s
}

pub fn init(m: &Monde, nom: &str, admin: bool, vitesse: f64, vex_url: &str) -> String {
    let terrain: String = m.cases.iter().map(|c| std::char::from_digit(c.terrain as u32, 10).unwrap()).collect();
    let depot: String = m.cases.iter().map(|c| std::char::from_digit(c.depot as u32, 10).unwrap()).collect();
    let cotes: String = (0..m.cases.len()).map(|i| if m.est_cote(i) { '1' } else { '0' }).collect();
    json!({
        "t": "init",
        "joueur": { "nom": nom, "admin": admin },
        "vitesse": vitesse,
        "vex_url": vex_url,
        "carte": { "largeur": m.largeur, "hauteur": m.hauteur, "terrain": terrain, "depot": depot, "cotes": cotes },
        "defs": {
            "ressources": RESSOURCES,
            "terrains": TERRAINS,
            "depots": DEPOTS,
            "batiments": BATIMENTS,
            "unites": UNITES,
            "techs": TECHS,
            "ameliorations": AMELIORATIONS,
            "branches": BRANCHES.iter().map(|(id, nom, icone, couleur)| json!({"id": id, "nom": nom, "icone": icone, "couleur": couleur})).collect::<Vec<_>>(),
            "specialisations": SPECIALISATIONS,
            "couleurs": COULEURS_PAYS,
            "emblemes": EMBLEMES,
            "minerais": fab::MINERAIS,
            "elements": fab::ELEMENTS.iter().map(|e| {
                let (minerai, qte, temps) = fab::recette_raffinage(e.id).unwrap_or(("", 0.0, 0.0));
                json!({"z": e.z, "id": e.id, "nom": e.nom, "categorie": e.categorie, "prix": fab::prix_objet(e.id),
                    "demi_vie": fab::demi_vie(e), "minerai": minerai, "qte": qte, "temps": temps})
            }).collect::<Vec<_>>(),
            "produits": fab::tous_produits().map(|p| {
                let mut v = serde_json::to_value(p).unwrap_or(Value::Null);
                let o = v.as_object_mut().unwrap();
                o.insert("prix".into(), json!(fab::prix_objet(p.id)));
                if let Some(e) = fab::effet_de(p.id) {
                    o.insert("effet".into(), json!({ "type": e.effet, "texte": fab::texte_effet(e), "par_unite": e.par_unite, "max": e.max }));
                }
                v
            }).collect::<Vec<_>>(),
            "index_minerais": fab::MINERAIS.iter().map(|mi| (mi.id, fab::index_minerai(mi.id))).collect::<HashMap<_, _>>(),
            "troupes": { "cout_neutre": crate::front::COUT_NEUTRE, "portee_bateau": crate::front::PORTEE_BATEAU, "portee_cote": crate::front::PORTEE_COTE },
            "file_fabrication": jeu::FILE_FABRICATION,
            "lignes_max": jeu::LIGNES_MAX,
            "prix_plan": jeu::PRIX_PLAN,
        }
    })
    .to_string()
}

fn vue_armee(a: &Armee, niveau: u8) -> Value {
    // niveau 2 = proprietaire, 1 = allie ou renseigne, 0 = etranger
    let dom = jeu::domaine(a);
    let total: u32 = a.unites.values().sum();
    let principal = a
        .unites
        .iter()
        .max_by(|x, y| {
            let px = *x.1 as f64 * unite(x.0).map(|u| u.puissance).unwrap_or(1.0);
            let py = *y.1 as f64 * unite(y.0).map(|u| u.puissance).unwrap_or(1.0);
            px.partial_cmp(&py).unwrap()
        })
        .map(|x| x.0.clone())
        .unwrap_or_default();
    let mut o = json!({
        "id": a.id,
        "proprio": a.proprio,
        "case": a.case,
        "dom": dom,
        "principal": principal,
        "progres": a.progres,
        "prochaine": a.chemin.first(),
        "assaut": a.assaut,
        "vitesse": jeu::vitesse_armee(a),
    });
    let map = o.as_object_mut().unwrap();
    if niveau >= 1 {
        map.insert("unites".into(), json!(a.unites));
        map.insert("nom".into(), json!(a.nom));
        map.insert("total".into(), json!(total));
    } else {
        // Estimation grossiere : arrondi a 5 pres.
        let approx = ((total as f64 / 5.0).round() * 5.0).max(5.0) as u32;
        map.insert("estimation".into(), json!(approx));
    }
    if niveau >= 2 {
        map.insert("chemin".into(), json!(a.chemin));
        map.insert("bombarde".into(), json!(a.bombarde));
        let blessures: f64 = a.blessures.values().sum();
        map.insert("blessures".into(), json!(blessures));
    }
    o
}

pub fn pays_publics(m: &Monde, bl: &HashMap<u32, Bilan>) -> Vec<Value> {
    let maint = chrono::Utc::now().timestamp();
    m.pays
        .values()
        .map(|p| {
            let b = bl.get(&p.id).cloned().unwrap_or_default();
            json!({
                "id": p.id,
                "nom": p.nom,
                "joueur": p.joueur,
                "bot": crate::bots::est_bot(p.user_id),
                "couleur": p.couleur,
                "embleme": p.embleme,
                "devise": p.devise,
                "spe": p.spe,
                "capitale": p.capitale,
                "bloc": p.bloc,
                "elimine": p.elimine,
                "protection": (p.protection - maint).max(0),
                "cases": b.cases,
                "pop": p.pop.round(),
                "score": jeu::scores(p, &b)["global"],
                "cree": p.cree,
                "actif": p.actif,
            })
        })
        .collect()
}

pub fn classement(m: &Monde, bl: &HashMap<u32, Bilan>) -> Vec<Value> {
    m.pays
        .values()
        .filter(|p| !p.elimine)
        .map(|p| {
            let b = bl.get(&p.id).cloned().unwrap_or_default();
            json!({ "id": p.id, "scores": jeu::scores(p, &b) })
        })
        .collect()
}

pub struct Contexte<'a> {
    pub m: &'a Monde,
    pub bl: &'a HashMap<u32, Bilan>,
    pub vis: &'a Visions,
    /// Liste publique des pays / blocs / classement, pre-calculee une
    /// fois par tick et partagee par tous les clients.
    pub publics: Option<&'a Value>,
}

pub fn etat(ctx: &Contexte, pid: Option<u32>, suivi: &mut Suivi) -> String {
    let m = ctx.m;
    let premier = !suivi.premier;
    suivi.premier = true;

    // ── Cases modifiees ──
    let cases: Vec<Value> = m
        .cases
        .iter()
        .enumerate()
        .filter(|(_, c)| c.rev > suivi.rev)
        .map(|(i, c)| {
            json!([
                i,
                c.proprio.map(|x| x as i64).unwrap_or(-1),
                c.bat.as_deref().unwrap_or(""),
                c.niv,
                if c.irradiee > m.temps { 1 } else { 0 }
            ])
        })
        .collect();
    suivi.rev = m.rev;

    let moi_p = pid.and_then(|id| m.pays.get(&id));
    let bloc = moi_p.and_then(|p| p.bloc);
    let renseigne = moi_p.map(|p| p.a("dip_renseignement")).unwrap_or(false);
    let vue = pid.and_then(|id| ctx.vis.vue.get(&id));
    let radar = pid.and_then(|id| ctx.vis.radar.get(&id));

    // ── Armees visibles ──
    let mut armees = Vec::new();
    if let Some(pid) = pid {
        for a in m.armees.values() {
            let niveau = if a.proprio == pid {
                2
            } else if m.meme_bloc(pid, a.proprio) {
                1
            } else {
                let visible = vue.map(|v| v[a.case]).unwrap_or(false);
                if !visible {
                    continue;
                }
                let furtive = a.unites.keys().all(|t| unite(t).map(|u| u.furtif).unwrap_or(false));
                if furtive && !radar.map(|r| r[a.case]).unwrap_or(false) {
                    continue;
                }
                if renseigne { 1 } else { 0 }
            };
            armees.push(vue_armee(a, niveau));
        }
    }

    // ── Missions et missiles ──
    let missions: Vec<Value> = m
        .missions
        .values()
        .filter(|mi| match pid {
            Some(p) => mi.proprio == p || m.meme_bloc(p, mi.proprio) || m.cases[mi.cible].proprio == Some(p) || vue.map(|v| v[mi.cible]).unwrap_or(false),
            None => false,
        })
        .map(|mi| {
            let mine = pid.map(|p| p == mi.proprio).unwrap_or(false);
            json!({
                "id": mi.id, "proprio": mi.proprio, "base": mi.base, "cible": mi.cible,
                "retour": mi.retour, "progres": mi.progres, "duree": mi.duree,
                "unites": if mine { json!(mi.unites) } else { Value::Null },
            })
        })
        .collect();
    // Offensives : les siennes, et celles qui visent son territoire.
    let attaques: Vec<Value> = m
        .attaques
        .values()
        .filter(|a| pid.is_some() && (Some(a.de) == pid || a.cible == pid))
        .map(|a| json!({"id": a.id, "de": a.de, "cible": a.cible, "troupes": a.troupes.floor(), "vise": a.vise, "prises": a.prises,
            "bateau": a.bateau.map(|(c, r)| json!({"case": c, "reste": r}))}))
        .collect();
    let missiles: Vec<Value> = m
        .missiles
        .values()
        .map(|x| json!({"id": x.id, "proprio": x.proprio, "genre": x.genre, "depart": x.depart, "cible": x.cible, "progres": x.progres, "duree": x.duree}))
        .collect();

    // ── Evenements et chat ──
    let evts: Vec<&Evenement> = m
        .evenements
        .iter()
        .filter(|e| e.t > suivi.evt && (e.pays.is_none() || e.pays == pid))
        .collect();
    let evts: Vec<&Evenement> = if premier { evts.into_iter().rev().take(80).rev().collect() } else { evts };
    if let Some(e) = m.evenements.back() {
        suivi.evt = suivi.evt.max(e.t);
    }
    let canal_bloc = bloc.map(|b| format!("bloc:{}", b));
    let chat: Vec<&MessageChat> = m
        .chat
        .iter()
        .filter(|c| c.id > suivi.chat && (c.canal == "global" || Some(&c.canal) == canal_bloc.as_ref()))
        .collect();
    let chat: Vec<&MessageChat> = if premier { chat.into_iter().rev().take(100).rev().collect() } else { chat };
    suivi.chat = m.prochain_msg;

    // ── Relations ──
    let mut relations = Map::new();
    let mut propositions = Vec::new();
    if let Some(pid) = pid {
        for (k, r) in &m.relations {
            let mut it = k.split('-').filter_map(|x| x.parse::<u32>().ok());
            let (a, b) = (it.next().unwrap_or(0), it.next().unwrap_or(0));
            let autre = if a == pid { b } else if b == pid { a } else { continue };
            let etat = match r.etat {
                Etat::Paix => "paix",
                Etat::Guerre => "guerre",
                Etat::Pna => "pna",
            };
            relations.insert(autre.to_string(), json!({"etat": etat, "depuis": r.depuis, "jusqu": r.jusqu}));
        }
        for p in &m.propositions {
            if p.a == pid || p.de == pid {
                propositions.push(json!(p));
            }
        }
    }

    // ── Mon pays ──
    let moi = match moi_p {
        Some(p) => {
            let b = ctx.bl.get(&p.id).cloned().unwrap_or_default();
            let mut v = serde_json::to_value(p).unwrap_or(Value::Null);
            let o = v.as_object_mut().unwrap();
            o.insert("bilan".into(), json!(b));
            o.insert("scores".into(), jeu::scores(p, &b));
            o.insert(
                "mods".into(),
                json!({
                    "siderurgie": p.niv("siderurgie"),
                    "robotique": p.niv("robotique"),
                    "logistique": p.niv("logistique"),
                    "niv_max": jeu::niveau_max(p),
                    "frais": jeu::frais_marche(p),
                    "mondialisation": p.a("eco_mondialisation"),
                }),
            );
            v
        }
        None => Value::Null,
    };

    let mut out = json!({
        "t": "etat",
        "temps": m.temps,
        "now": chrono::Utc::now().timestamp_millis(),
        "cases": cases,
        "moi": moi,
        "vision": vue.map(|v| hex_bits(v)),
        "armees": armees,
        "missions": missions,
        "missiles": missiles,
        "attaques": attaques,
        "relations": relations,
        "propositions": propositions,
        "evenements": evts,
        "chat": chat,
        "effets": m.effets,
        "nuages": m.nuages.iter().map(|n| json!({ "id": n.id, "case": n.case })).collect::<Vec<_>>(),
        "prix": m.prix,
        // Change avec « Nouvelle carte » (admin) : les clients rechargent.
        "graine": m.graine,
        "cours": m.cours,
        "bots": m.bots_admin,
    });
    if let Some(p) = ctx.publics {
        out.as_object_mut().unwrap().insert("publics".into(), p.clone());
    }
    out.to_string()
}

pub fn publics(m: &Monde, bl: &HashMap<u32, Bilan>) -> Value {
    json!({
        "pays": pays_publics(m, bl),
        "blocs": m.blocs.values().collect::<Vec<_>>(),
        "classement": classement(m, bl),
    })
}
