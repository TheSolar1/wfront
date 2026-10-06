// ══════════════════════════════════════════════════════════════════
// admin.rs — Cle d'administration
//
// Seul le detenteur de la cle privee Ed25519 dont la cle publique est dans
// config.json (admin_cle_publique) voit et utilise l'administration :
//   GET  /admin/defi    -> message a signer (lie au joueur, usage unique)
//   POST /admin/prouver -> signature faite DANS LE NAVIGATEUR (la cle privee
//                          ne quitte jamais le PC), cookie wf_admin
// Autre moyen, sans aucun fichier : les cles d'acces (passkeys, voir
// passkey.rs), dont le serveur ne garde que la cle publique.
// Le jeton (30 jours) ne vaut que pour le joueur qui l'a obtenu ; il est
// garde dans data/admin_jetons.json pour survivre aux redemarrages.
// ══════════════════════════════════════════════════════════════════

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use crate::passkey::CleAcces;
use rand::Rng;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// Duree d'un deverrouillage (secondes).
pub const DUREE: i64 = 30 * 24 * 3600;
const DUREE_DEFI: i64 = 300;

#[derive(Default)]
pub struct Admin {
    /// Dossier des fichiers (vide = rien n'est enregistre, pour les tests).
    dossier: Option<PathBuf>,
    /// message ou defi -> (joueur, cree)
    defis: Mutex<HashMap<String, (i64, i64)>>,
    /// jeton -> (joueur, expire)
    jetons: Mutex<HashMap<String, (i64, i64)>>,
    /// Cles d'acces enregistrees (cles publiques seulement).
    pub cles: Mutex<Vec<CleAcces>>,
    /// Code de recuperation a usage unique, ecrit dans data/admin_code.txt
    /// (seul quelqu'un qui a acces au serveur peut le lire). Sert a ouvrir
    /// l'administration sans fichier de cle, par exemple pour enregistrer
    /// une premiere cle d'acces.
    code: Mutex<Option<String>>,
}

fn maintenant() -> i64 {
    chrono::Utc::now().timestamp()
}

fn aleatoire() -> String {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut r = rand::thread_rng();
    (0..48).map(|_| ALPHA[r.gen_range(0..ALPHA.len())] as char).collect()
}

fn lire<T: serde::de::DeserializeOwned + Default>(f: &PathBuf) -> T {
    std::fs::read_to_string(f).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn ecrire<T: serde::Serialize>(f: &PathBuf, v: &T) {
    if let Some(d) = f.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let tmp = f.with_extension("tmp");
    if std::fs::write(&tmp, serde_json::to_string(v).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, f);
    }
}

impl Admin {
    pub fn charger(dossier: PathBuf) -> Admin {
        let t = maintenant();
        let jetons: HashMap<String, (i64, i64)> = lire(&dossier.join("admin_jetons.json"));
        let jetons = jetons.into_iter().filter(|(_, (_, exp))| *exp > t).collect();
        let cles: Vec<CleAcces> = lire(&dossier.join("admin_passkeys.json"));
        let a = Admin {
            dossier: Some(dossier),
            defis: Mutex::new(HashMap::new()),
            jetons: Mutex::new(jetons),
            cles: Mutex::new(cles),
            code: Mutex::new(None),
        };
        a.nouveau_code();
        a
    }

    /// Tire un nouveau code de recuperation et l'ecrit pour l'admin du serveur.
    pub fn nouveau_code(&self) {
        let mut r = rand::thread_rng();
        let code = format!("{:04}-{:04}", r.gen_range(0..10000), r.gen_range(0..10000));
        if let Some(d) = &self.dossier {
            let texte = format!(
                "Code de recuperation de l'administration WorldFront : {}\n\n\
                 A saisir sur la page /admin (usage unique). Un nouveau code est tire a chaque\n\
                 redemarrage du serveur et apres chaque utilisation.\n",
                code
            );
            let _ = std::fs::create_dir_all(d);
            let _ = std::fs::write(d.join("admin_code.txt"), texte);
            println!("[admin] code de recuperation dans {}", d.join("admin_code.txt").display());
        }
        *self.code.lock().unwrap() = Some(code);
    }

    /// Ouvre l'administration avec le code de recuperation (usage unique).
    pub fn utiliser_code(&self, code: &str, user_id: i64) -> Result<String, String> {
        let bon = self.code.lock().unwrap().clone().ok_or("Aucun code actif : redémarrez le serveur.")?;
        let saisi: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
        if saisi != bon.replace('-', "") {
            return Err("Code incorrect.".into());
        }
        self.nouveau_code();
        Ok(self.ouvrir(user_id))
    }

    fn sauver_jetons(&self, j: &HashMap<String, (i64, i64)>) {
        if let Some(d) = &self.dossier {
            ecrire(&d.join("admin_jetons.json"), j);
        }
    }

    pub fn sauver_cles(&self, c: &Vec<CleAcces>) {
        if let Some(d) = &self.dossier {
            ecrire(&d.join("admin_passkeys.json"), c);
        }
    }

    /// Defi aleatoire (base64url) pour une cle d'acces.
    pub fn defi_webauthn(&self, user_id: i64) -> String {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let mut octets = [0u8; 32];
        rand::thread_rng().fill(&mut octets);
        let defi = URL_SAFE_NO_PAD.encode(octets);
        let t = maintenant();
        let mut d = self.defis.lock().unwrap();
        d.retain(|_, (_, cree)| t - *cree < DUREE_DEFI);
        if d.len() < 1000 {
            d.insert(defi.clone(), (user_id, t));
        }
        defi
    }

    /// Utilise un defi (une seule fois, pour ce joueur, pas trop vieux).
    pub fn consommer_defi(&self, defi: &str, user_id: i64) -> Result<(), String> {
        let (pour, cree) = self.defis.lock().unwrap().remove(defi).ok_or("Défi inconnu ou déjà utilisé, recommencez.")?;
        if pour != user_id || maintenant() - cree > DUREE_DEFI {
            return Err("Défi expiré, recommencez.".into());
        }
        Ok(())
    }

    /// Ouvre l'administration pour ce joueur : rend le jeton du cookie.
    pub fn ouvrir(&self, user_id: i64) -> String {
        let jeton = aleatoire();
        let t = maintenant();
        let mut j = self.jetons.lock().unwrap();
        j.retain(|_, (_, exp)| *exp > t);
        j.insert(jeton.clone(), (user_id, t + DUREE));
        self.sauver_jetons(&j);
        jeton
    }

    pub fn defi(&self, user_id: i64) -> String {
        let t = maintenant();
        let message = format!("WorldFront admin|{}|{}|{}", user_id, t, aleatoire());
        let mut d = self.defis.lock().unwrap();
        d.retain(|_, (_, cree)| t - *cree < DUREE_DEFI);
        if d.len() < 1000 {
            d.insert(message.clone(), (user_id, t));
        }
        message
    }

    pub fn prouver(&self, cle_publique: &str, user_id: i64, message: &str, sig: &str) -> Result<String, String> {
        let (pour, cree) = self.defis.lock().unwrap().remove(message).ok_or("Défi inconnu ou déjà utilisé, recommencez.")?;
        if pour != user_id || maintenant() - cree > DUREE_DEFI {
            return Err("Défi expiré, recommencez.".into());
        }
        let cle: [u8; 32] = B64
            .decode(cle_publique.trim())
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or("admin_cle_publique invalide dans config.json.")?;
        let cle = VerifyingKey::from_bytes(&cle).map_err(|_| "admin_cle_publique invalide dans config.json.")?;
        let sig: [u8; 64] = B64.decode(sig.trim()).ok().and_then(|b| b.try_into().ok()).ok_or("Signature illisible.")?;
        cle.verify(message.as_bytes(), &Signature::from_bytes(&sig))
            .map_err(|_| "Ce n'est pas la clé d'administration de ce serveur.")?;
        Ok(self.ouvrir(user_id))
    }

    pub fn valide(&self, jeton: &str, user_id: i64) -> bool {
        if jeton.is_empty() {
            return false;
        }
        self.jetons
            .lock()
            .unwrap()
            .get(jeton)
            .map(|(u, exp)| *u == user_id && *exp > maintenant())
            .unwrap_or(false)
    }

    pub fn fermer(&self, jeton: &str) {
        let mut j = self.jetons.lock().unwrap();
        if j.remove(jeton).is_some() {
            self.sauver_jetons(&j);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn seule_la_bonne_cle_deverrouille() {
        let cle = SigningKey::from_bytes(&[7u8; 32]);
        let publique = B64.encode(cle.verifying_key().to_bytes());
        let autre = SigningKey::from_bytes(&[9u8; 32]);
        let a = Admin::default();

        let m = a.defi(42);
        let mauvaise = B64.encode(autre.sign(m.as_bytes()).to_bytes());
        assert!(a.prouver(&publique, 42, &m, &mauvaise).is_err());

        let m = a.defi(42);
        let bonne = B64.encode(cle.sign(m.as_bytes()).to_bytes());
        // Un autre joueur ne peut pas utiliser le defi de 42.
        assert!(a.prouver(&publique, 43, &m, &bonne).is_err());

        let m = a.defi(42);
        let bonne = B64.encode(cle.sign(m.as_bytes()).to_bytes());
        let jeton = a.prouver(&publique, 42, &m, &bonne).unwrap();
        assert!(a.valide(&jeton, 42));
        assert!(!a.valide(&jeton, 43));
        // Usage unique du defi.
        assert!(a.prouver(&publique, 42, &m, &bonne).is_err());
        a.fermer(&jeton);
        assert!(!a.valide(&jeton, 42));
    }
}
