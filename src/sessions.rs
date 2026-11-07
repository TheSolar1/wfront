// ══════════════════════════════════════════════════════════════════
// sessions.rs — Sessions WFront (cookie wf_session, 30 jours)
//
// Une session appartient a un compte WFront (« wf:pseudo », voir
// comptes.rs) ou a un invite (« invite:<hasard> »). Elles sont gardees
// dans data/sessions.json pour survivre aux redemarrages.
// ══════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub const DUREE_SESSION: i64 = 30 * 24 * 3600;

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionWf {
    /// Identite : « wf:pseudo » (compte WFront) ou « invite:... ».
    pub compte: String,
    pub nom: String,
    pub sombre: bool,
    pub expire: i64,
}

pub struct Sessions {
    fichier: PathBuf,
    sessions: Mutex<HashMap<String, SessionWf>>,
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

impl Sessions {
    pub fn charger(fichier: PathBuf) -> Sessions {
        let sessions: HashMap<String, SessionWf> = std::fs::read_to_string(&fichier)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let t = maintenant();
        // Seules les sessions de comptes WFront et d'invites sont reprises.
        let sessions = sessions
            .into_iter()
            .filter(|(_, s)| s.expire > t && (s.compte.starts_with(crate::comptes::PREFIXE) || s.compte.starts_with("invite:")))
            .collect();
        Sessions { fichier, sessions: Mutex::new(sessions) }
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

    /// Ouvre une session pour un compte deja verifie (compte WFront ou
    /// invite). Rend le jeton du cookie wf_session.
    pub fn ouvrir(&self, compte: &str, nom: &str, sombre: bool) -> String {
        let t = maintenant();
        let session = SessionWf { compte: compte.to_string(), nom: nom.to_string(), sombre, expire: t + DUREE_SESSION };
        let cle = aleatoire(48);
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, x| x.expire > t);
        sessions.insert(cle.clone(), session);
        self.enregistrer(&sessions);
        cle
    }

    /// Ouvre une session « invite » : pas de compte, un identifiant tire
    /// au hasard (personne ne peut reprendre la nation d'un autre en tapant
    /// le meme pseudo). Rend le jeton du cookie.
    pub fn session_invite(&self, nom: &str, sombre: bool) -> String {
        self.ouvrir(&format!("invite:{}", aleatoire(24)), nom, sombre)
    }

    /// Theme clair / sombre : la session du jeton, et toutes celles du meme
    /// compte (le choix suit le joueur sur ses autres appareils).
    pub fn changer_theme(&self, jeton: &str, sombre: bool) {
        let mut sessions = self.sessions.lock().unwrap();
        let Some(compte) = sessions.get(jeton).map(|s| s.compte.clone()) else { return };
        let invite = compte.starts_with("invite:");
        for (k, s) in sessions.iter_mut() {
            if k == jeton || (!invite && s.compte == compte) {
                s.sombre = sombre;
            }
        }
        self.enregistrer(&sessions);
    }

    /// Ferme toutes les sessions d'un compte sauf `garder` (changement de
    /// mot de passe : les autres appareils doivent se reconnecter).
    pub fn fermer_compte(&self, compte: &str, garder: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        let avant = sessions.len();
        sessions.retain(|k, s| k == garder || s.compte != compte);
        if sessions.len() != avant {
            self.enregistrer(&sessions);
        }
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

/// Identifiant numerique stable d'un compte (cle des nations).
pub fn id_compte(compte: &str) -> i64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in compte.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    // Plage distincte des bots (negatifs).
    (h >> 2) as i64 + (1 << 61)
}
