// ══════════════════════════════════════════════════════════════════
// admin.rs — Cle d'administration
//
// Seul le detenteur de la cle privee Ed25519 dont la cle publique est dans
// config.json (admin_cle_publique) voit et utilise l'administration :
//   GET  /admin/defi    -> message a signer (lie au joueur, usage unique)
//   POST /admin/prouver -> signature faite DANS LE NAVIGATEUR (la cle privee
//                          ne quitte jamais le PC), cookie wf_admin
// Le jeton est garde en memoire : un redemarrage du serveur oblige a
// re-prouver, et il ne vaut que pour le joueur qui l'a obtenu.
// ══════════════════════════════════════════════════════════════════

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rand::Rng;
use std::collections::HashMap;
use std::sync::Mutex;

/// Duree d'un deverrouillage (secondes).
pub const DUREE: i64 = 12 * 3600;
const DUREE_DEFI: i64 = 300;

#[derive(Default)]
pub struct Admin {
    /// message -> (joueur, cree)
    defis: Mutex<HashMap<String, (i64, i64)>>,
    /// jeton -> (joueur, expire)
    jetons: Mutex<HashMap<String, (i64, i64)>>,
}

fn maintenant() -> i64 {
    chrono::Utc::now().timestamp()
}

fn aleatoire() -> String {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut r = rand::thread_rng();
    (0..48).map(|_| ALPHA[r.gen_range(0..ALPHA.len())] as char).collect()
}

impl Admin {
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
        let jeton = aleatoire();
        let t = maintenant();
        let mut j = self.jetons.lock().unwrap();
        j.retain(|_, (_, exp)| *exp > t);
        j.insert(jeton.clone(), (user_id, t + DUREE));
        Ok(jeton)
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
        self.jetons.lock().unwrap().remove(jeton);
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
