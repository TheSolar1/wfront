// ══════════════════════════════════════════════════════════════════
// reseau.rs — « Se connecter avec VEX » (n'importe quel nœud du reseau)
//
//   /auth/debut?noeud=vex.exemple.org
//      -> GET {noeud}/p2p/ping : node_id + cle publique Ed25519 du nœud
//      -> verifie que ce nœud figure dans l'annuaire du reseau VEX
//      -> redirige vers {noeud}/p2p/sso?service=WorldFront&retour=..&etat=..
//   /auth/retour?etat=..&jeton=..&sig=..
//      -> verifie la signature du jeton avec la cle du nœud, l'etat,
//         l'adresse de retour et l'expiration, puis ouvre une session
//         WorldFront (cookie wf_session, 30 jours).
//
// Le mot de passe ne quitte jamais le nœud de l'utilisateur. Un nœud ne
// peut signer que pour SES comptes : l'identite retenue est
// « user_id@node_id », jamais un simple nom.
// ══════════════════════════════════════════════════════════════════

use base64::{engine::general_purpose::STANDARD as B64, engine::general_purpose::URL_SAFE_NO_PAD as B64URL, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

pub const DUREE_SESSION: i64 = 30 * 24 * 3600;
const DUREE_ATTENTE: i64 = 600;
const CACHE_ANNUAIRE: i64 = 600;

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionWf {
    /// Identite reseau « user_id@node_id ».
    pub compte: String,
    pub nom: String,
    /// Adresse du nœud VEX de l'utilisateur (liens de la barre VEX).
    pub noeud: String,
    pub sombre: bool,
    pub expire: i64,
}

struct Attente {
    noeud: String,
    node_id: String,
    pub_key: String,
    cree: i64,
}

pub struct Reseau {
    fichier: PathBuf,
    sessions: Mutex<HashMap<String, SessionWf>>,
    attentes: Mutex<HashMap<String, Attente>>,
    annuaire: Mutex<Option<(i64, String)>>,
}

fn maintenant() -> i64 {
    chrono::Utc::now().timestamp()
}

fn aleatoire(n: usize) -> String {
    use rand::Rng;
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut r = rand::thread_rng();
    (0..n).map(|_| ALPHA[r.gen_range(0..ALPHA.len())] as char).collect()
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(8))
        .redirects(2)
        .user_agent("WorldFront/0.1")
        .build()
}

/// « vex.exemple.org », « https://vex.exemple.org/login/dashboard » -> « https://vex.exemple.org »
pub fn normaliser_noeud(brut: &str) -> Option<String> {
    let t = brut.trim().trim_end_matches('/');
    if t.is_empty() || t.len() > 200 || t.chars().any(|c| c.is_whitespace() || c == '"' || c == '<' || c == '>' || c == '\'') {
        return None;
    }
    let (schema, reste) = match t.split_once("://") {
        Some((s, r)) if s == "http" || s == "https" => (s.to_string(), r.to_string()),
        Some(_) => return None,
        None => ("https".to_string(), t.to_string()),
    };
    let hote = reste.split(['/', '?', '#']).next().unwrap_or("");
    if hote.is_empty() {
        return None;
    }
    Some(format!("{}://{}", schema, hote))
}

impl Reseau {
    pub fn charger(fichier: PathBuf) -> Reseau {
        let sessions: HashMap<String, SessionWf> = std::fs::read_to_string(&fichier)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let t = maintenant();
        let sessions = sessions.into_iter().filter(|(_, s)| s.expire > t).collect();
        Reseau {
            fichier,
            sessions: Mutex::new(sessions),
            attentes: Mutex::new(HashMap::new()),
            annuaire: Mutex::new(None),
        }
    }

    fn enregistrer(&self, sessions: &HashMap<String, SessionWf>) {
        if let Some(d) = self.fichier.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let tmp = self.fichier.with_extension("tmp");
        if std::fs::write(&tmp, serde_json::to_string(sessions).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(&tmp, &self.fichier);
        }
    }

    pub fn session(&self, jeton: &str) -> Option<SessionWf> {
        if jeton.is_empty() {
            return None;
        }
        let s = self.sessions.lock().unwrap();
        s.get(jeton).filter(|x| x.expire > maintenant()).cloned()
    }

    pub fn fermer(&self, jeton: &str) {
        let mut s = self.sessions.lock().unwrap();
        if s.remove(jeton).is_some() {
            self.enregistrer(&s);
        }
    }

    fn annuaire(&self, url: &str) -> Result<String, String> {
        if let Some((t, texte)) = self.annuaire.lock().unwrap().clone() {
            if maintenant() - t < CACHE_ANNUAIRE {
                return Ok(texte);
            }
        }
        let texte = agent()
            .get(url)
            .call()
            .map_err(|e| format!("annuaire du réseau VEX injoignable ({})", e))?
            .into_string()
            .map_err(|e| e.to_string())?;
        *self.annuaire.lock().unwrap() = Some((maintenant(), texte.clone()));
        Ok(texte)
    }

    /// Etape 1 : identifie le nœud et prepare la redirection vers son /p2p/sso.
    /// Bloquant (requetes HTTP) : a appeler depuis spawn_blocking.
    pub fn debut(&self, noeud_brut: &str, retour: &str, annuaire_url: &str) -> Result<String, String> {
        let noeud = normaliser_noeud(noeud_brut).ok_or("Adresse de nœud invalide.")?;
        let ping: Value = agent()
            .get(&format!("{}/p2p/ping", noeud))
            .call()
            .map_err(|_| format!("Le nœud {} ne répond pas (est-ce bien un serveur VEX ?).", noeud))?
            .into_json()
            .map_err(|_| format!("{} ne ressemble pas à un nœud VEX.", noeud))?;
        let node_id = ping.get("node_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let pub_key = ping.get("pub_key").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if node_id.is_empty() || pub_key.is_empty() {
            return Err(format!("{} ne ressemble pas à un nœud VEX.", noeud));
        }
        if !annuaire_url.is_empty() {
            let texte = self.annuaire(annuaire_url)?;
            let connu = texte.lines().any(|l| {
                let c: Vec<&str> = l.split('|').map(|x| x.trim()).collect();
                c.len() >= 4 && c[0] == node_id && c[3] == pub_key
            });
            if !connu {
                return Err(format!("{} n'est pas (encore) enregistré dans l'annuaire du réseau VEX.", noeud));
            }
        }
        let etat = aleatoire(40);
        {
            let mut a = self.attentes.lock().unwrap();
            let t = maintenant();
            a.retain(|_, x| t - x.cree < DUREE_ATTENTE);
            if a.len() > 5000 {
                return Err("Trop de connexions en cours, réessayez dans un instant.".into());
            }
            a.insert(etat.clone(), Attente { noeud: noeud.clone(), node_id, pub_key, cree: t });
        }
        Ok(format!(
            "{}/p2p/sso?service=WorldFront&retour={}&etat={}",
            noeud,
            encoder(retour),
            etat
        ))
    }

    /// Etape 2 : verifie le jeton signe par le nœud et ouvre une session.
    /// Rend (jeton de session, session).
    pub fn retour(&self, q: &HashMap<String, String>, retour_attendu: &str) -> Result<(String, SessionWf), String> {
        let etat = q.get("etat").cloned().unwrap_or_default();
        let attente = self
            .attentes
            .lock()
            .unwrap()
            .remove(&etat)
            .ok_or("Demande de connexion inconnue ou expirée, recommencez.")?;
        if maintenant() - attente.cree > DUREE_ATTENTE {
            return Err("Demande de connexion expirée, recommencez.".into());
        }
        if q.get("erreur").map(|s| s.as_str()) == Some("refus") {
            return Err("Connexion refusée sur votre nœud VEX.".into());
        }
        let jeton = q.get("jeton").cloned().unwrap_or_default();
        let sig = q.get("sig").cloned().unwrap_or_default();

        // Signature Ed25519 du nœud sur la chaine du jeton.
        let cle: [u8; 32] = B64
            .decode(&attente.pub_key)
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or("Clé du nœud invalide.")?;
        let cle = VerifyingKey::from_bytes(&cle).map_err(|_| "Clé du nœud invalide.")?;
        let sig: [u8; 64] = B64URL
            .decode(sig.as_bytes())
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or("Signature illisible.")?;
        cle.verify(jeton.as_bytes(), &Signature::from_bytes(&sig))
            .map_err(|_| "Signature du nœud invalide.")?;

        let charge: Value = B64URL
            .decode(jeton.as_bytes())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .ok_or("Jeton illisible.")?;
        let s = |k: &str| charge.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let t = maintenant();
        if s("node_id") != attente.node_id || s("etat") != etat || s("retour") != retour_attendu {
            return Err("Jeton destiné à une autre demande.".into());
        }
        let exp = charge.get("exp").and_then(|v| v.as_i64()).unwrap_or(0);
        let iat = charge.get("iat").and_then(|v| v.as_i64()).unwrap_or(0);
        if exp < t || iat > t + 120 {
            return Err("Jeton expiré (vérifiez l'heure du serveur).".into());
        }
        let user_id = charge.get("user_id").and_then(|v| v.as_i64()).ok_or("Jeton incomplet.")?;
        let nom: String = s("nom").chars().filter(|c| !c.is_control()).take(40).collect();
        let session = SessionWf {
            compte: format!("{}@{}", user_id, attente.node_id),
            nom: if nom.trim().is_empty() { format!("joueur{}", user_id) } else { nom },
            noeud: attente.noeud,
            sombre: charge.get("sombre").and_then(|v| v.as_bool()).unwrap_or(false),
            expire: t + DUREE_SESSION,
        };
        let cle_session = aleatoire(48);
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, x| x.expire > t);
        sessions.insert(cle_session.clone(), session.clone());
        self.enregistrer(&sessions);
        Ok((cle_session, session))
    }
}

pub fn encoder(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

/// Identifiant numerique stable d'un compte reseau (cle des nations).
pub fn id_compte(compte: &str) -> i64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in compte.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    // Plage distincte des ids VEX (positifs) et du mode dev (negatifs).
    (h >> 2) as i64 + (1 << 61)
}
