// ══════════════════════════════════════════════════════════════════
// comptes.rs — Comptes WFront (mode "comptes", celui de la sortie)
//
// Le jeu gere lui-meme ses joueurs, sans VEX : un pseudo unique et un
// mot de passe. Le mot de passe n'est jamais garde en clair : seul son
// empreinte Argon2id (sel aleatoire) est ecrite dans data/comptes.json.
//
// L'identite d'un compte est « wf:<pseudo en minuscules> » : c'est elle
// qui donne l'identifiant numerique de la nation (reseau::id_compte) et
// qu'on compare a la liste « admins » de config.json.
// ══════════════════════════════════════════════════════════════════

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub const PREFIXE: &str = "wf:";
const MDP_MIN: usize = 8;
const MDP_MAX: usize = 128;
/// Essais ratés tolérés par adresse IP sur la fenêtre, avant blocage.
const ECHECS_MAX: u32 = 10;
const FENETRE_ECHECS: i64 = 15 * 60;
/// Comptes créés au plus par adresse IP et par heure.
const CREATIONS_MAX: u32 = 5;

/// Pseudos interdits (confusion avec l'equipe ou le systeme).
const RESERVES: &[&str] = &["admin", "administrateur", "administration", "wfront", "systeme", "system", "moderateur", "invite", "bot", "serveur"];

#[derive(Serialize, Deserialize, Clone)]
pub struct Compte {
    /// Pseudo tel que choisi (casse conservee).
    pub nom: String,
    /// Empreinte Argon2id au format PHC (contient le sel et les parametres).
    hash: String,
    #[serde(default)]
    pub sombre: bool,
    pub cree: i64,
}

impl Compte {
    /// Identite stable « wf:pseudo » (minuscules).
    pub fn identite(&self) -> String {
        format!("{}{}", PREFIXE, self.nom.to_lowercase())
    }
}

pub struct Comptes {
    fichier: PathBuf,
    /// pseudo en minuscules -> compte
    liste: Mutex<HashMap<String, Compte>>,
    /// IP -> (essais ratés, début de la fenêtre)
    echecs: Mutex<HashMap<String, (u32, i64)>>,
    /// IP -> (comptes créés, début de la fenêtre)
    creations: Mutex<HashMap<String, (u32, i64)>>,
}

fn maintenant() -> i64 {
    chrono::Utc::now().timestamp()
}

fn hacher(mdp: &str) -> Result<String, String> {
    let sel = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(mdp.as_bytes(), &sel)
        .map(|h| h.to_string())
        .map_err(|_| "Erreur interne (mot de passe).".to_string())
}

fn mdp_correct(hash: &str, mdp: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| Argon2::default().verify_password(mdp.as_bytes(), &h).is_ok())
        .unwrap_or(false)
}

/// Pseudo propre (3 a 20 caracteres : lettres, chiffres, « _ », « - », « . »).
pub fn valider_pseudo(brut: &str) -> Result<String, String> {
    let nom = brut.trim();
    let n = nom.chars().count();
    if !(3..=20).contains(&n) {
        return Err("Le pseudo doit faire de 3 à 20 caractères.".into());
    }
    if !nom.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.')) {
        return Err("Le pseudo ne peut contenir que des lettres, des chiffres, « _ », « - » et « . ».".into());
    }
    if RESERVES.contains(&nom.to_lowercase().as_str()) {
        return Err("Ce pseudo est réservé, choisissez-en un autre.".into());
    }
    Ok(nom.to_string())
}

pub fn valider_mdp(mdp: &str) -> Result<(), String> {
    let n = mdp.chars().count();
    if n < MDP_MIN {
        return Err(format!("Le mot de passe doit faire au moins {} caractères.", MDP_MIN));
    }
    if n > MDP_MAX {
        return Err(format!("Le mot de passe doit faire au plus {} caractères.", MDP_MAX));
    }
    Ok(())
}

impl Comptes {
    pub fn charger(fichier: PathBuf) -> Comptes {
        let liste: HashMap<String, Compte> = std::fs::read_to_string(&fichier)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Comptes {
            fichier,
            liste: Mutex::new(liste),
            echecs: Mutex::new(HashMap::new()),
            creations: Mutex::new(HashMap::new()),
        }
    }

    fn enregistrer(&self, liste: &HashMap<String, Compte>) {
        if let Some(d) = self.fichier.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let tmp = self.fichier.with_extension("tmp");
        if std::fs::write(&tmp, serde_json::to_string(liste).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(&tmp, &self.fichier);
        }
    }

    /// Compte d'une identite « wf:pseudo ».
    pub fn par_identite(&self, identite: &str) -> Option<Compte> {
        let cle = identite.strip_prefix(PREFIXE)?;
        self.liste.lock().unwrap().get(cle).cloned()
    }

    fn bloque(&self, ip: &str) -> bool {
        let t = maintenant();
        let e = self.echecs.lock().unwrap();
        e.get(ip).map(|(n, debut)| *n >= ECHECS_MAX && t - debut < FENETRE_ECHECS).unwrap_or(false)
    }

    fn noter_echec(&self, ip: &str) {
        let t = maintenant();
        let mut e = self.echecs.lock().unwrap();
        e.retain(|_, (_, debut)| t - *debut < FENETRE_ECHECS);
        let x = e.entry(ip.to_string()).or_insert((0, t));
        x.0 += 1;
    }

    /// Création d'un compte. Lent (Argon2) : à appeler depuis spawn_blocking.
    pub fn creer(&self, pseudo: &str, mdp: &str, sombre: bool, ip: &str) -> Result<Compte, String> {
        let nom = valider_pseudo(pseudo)?;
        valider_mdp(mdp)?;
        let cle = nom.to_lowercase();
        if self.liste.lock().unwrap().contains_key(&cle) {
            return Err("Ce pseudo est déjà pris.".into());
        }
        {
            let t = maintenant();
            let mut c = self.creations.lock().unwrap();
            c.retain(|_, (_, debut)| t - *debut < 3600);
            let x = c.entry(ip.to_string()).or_insert((0, t));
            if x.0 >= CREATIONS_MAX {
                return Err("Trop de comptes créés depuis cette adresse ; réessayez plus tard.".into());
            }
            x.0 += 1;
        }
        let compte = Compte { nom, hash: hacher(mdp)?, sombre, cree: maintenant() };
        let mut liste = self.liste.lock().unwrap();
        // Revérifié sous le verrou : deux inscriptions simultanées du même pseudo.
        if liste.contains_key(&cle) {
            return Err("Ce pseudo est déjà pris.".into());
        }
        liste.insert(cle, compte.clone());
        self.enregistrer(&liste);
        Ok(compte)
    }

    /// Connexion. Lent (Argon2) : à appeler depuis spawn_blocking.
    pub fn verifier(&self, pseudo: &str, mdp: &str, ip: &str) -> Result<Compte, String> {
        if self.bloque(ip) {
            return Err("Trop d'essais ratés depuis cette adresse : réessayez dans un quart d'heure.".into());
        }
        let compte = self.liste.lock().unwrap().get(&pseudo.trim().to_lowercase()).cloned();
        match compte {
            Some(c) if mdp_correct(&c.hash, mdp) => Ok(c),
            _ => {
                self.noter_echec(ip);
                Err("Pseudo ou mot de passe incorrect.".into())
            }
        }
    }

    /// Changement de mot de passe (l'ancien est exigé). Lent : spawn_blocking.
    pub fn changer_mdp(&self, identite: &str, ancien: &str, nouveau: &str, ip: &str) -> Result<(), String> {
        if self.bloque(ip) {
            return Err("Trop d'essais ratés depuis cette adresse : réessayez dans un quart d'heure.".into());
        }
        let cle = identite.strip_prefix(PREFIXE).ok_or("Ce n'est pas un compte WFront.")?.to_string();
        let compte = self.liste.lock().unwrap().get(&cle).cloned().ok_or("Compte introuvable.")?;
        if !mdp_correct(&compte.hash, ancien) {
            self.noter_echec(ip);
            return Err("Mot de passe actuel incorrect.".into());
        }
        valider_mdp(nouveau)?;
        let hash = hacher(nouveau)?;
        let mut liste = self.liste.lock().unwrap();
        if let Some(c) = liste.get_mut(&cle) {
            c.hash = hash;
        }
        self.enregistrer(&liste);
        Ok(())
    }

    pub fn changer_theme(&self, identite: &str, sombre: bool) {
        let Some(cle) = identite.strip_prefix(PREFIXE) else { return };
        let mut liste = self.liste.lock().unwrap();
        if let Some(c) = liste.get_mut(cle) {
            if c.sombre != sombre {
                c.sombre = sombre;
                self.enregistrer(&liste);
            }
        }
    }

    /// Suppression du compte (le mot de passe est exigé). Lent : spawn_blocking.
    pub fn supprimer(&self, identite: &str, mdp: &str, ip: &str) -> Result<(), String> {
        if self.bloque(ip) {
            return Err("Trop d'essais ratés depuis cette adresse : réessayez dans un quart d'heure.".into());
        }
        let cle = identite.strip_prefix(PREFIXE).ok_or("Ce n'est pas un compte WFront.")?.to_string();
        let compte = self.liste.lock().unwrap().get(&cle).cloned().ok_or("Compte introuvable.")?;
        if !mdp_correct(&compte.hash, mdp) {
            self.noter_echec(ip);
            return Err("Mot de passe incorrect.".into());
        }
        let mut liste = self.liste.lock().unwrap();
        liste.remove(&cle);
        self.enregistrer(&liste);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> Comptes {
        let f = std::env::temp_dir().join(format!("wf-comptes-{}-{}.json", std::process::id(), rand::random::<u32>()));
        Comptes::charger(f)
    }

    #[test]
    fn creation_et_connexion() {
        let c = temp();
        let compte = c.creer("Clement", "motdepasse1", false, "1.1.1.1").unwrap();
        assert_eq!(compte.identite(), "wf:clement");
        assert!(c.creer("clement", "autremotdepasse", false, "1.1.1.1").is_err(), "pseudo unique, sans tenir compte de la casse");
        assert!(c.verifier("CLEMENT", "motdepasse1", "1.1.1.1").is_ok());
        assert!(c.verifier("clement", "mauvais!!", "1.1.1.1").is_err());
        c.changer_mdp("wf:clement", "motdepasse1", "nouveau-mdp", "1.1.1.1").unwrap();
        assert!(c.verifier("clement", "nouveau-mdp", "1.1.1.1").is_ok());
        c.supprimer("wf:clement", "nouveau-mdp", "1.1.1.1").unwrap();
        assert!(c.verifier("clement", "nouveau-mdp", "1.1.1.1").is_err());
    }

    #[test]
    fn validations_et_blocage() {
        let c = temp();
        assert!(c.creer("ab", "motdepasse1", false, "2.2.2.2").is_err());
        assert!(c.creer("a b c", "motdepasse1", false, "2.2.2.2").is_err());
        assert!(c.creer("admin", "motdepasse1", false, "2.2.2.2").is_err());
        assert!(c.creer("joueur", "court", false, "2.2.2.2").is_err());
        c.creer("joueur", "motdepasse1", false, "2.2.2.2").unwrap();
        for _ in 0..ECHECS_MAX {
            let _ = c.verifier("joueur", "faux-faux", "3.3.3.3");
        }
        // Bloqué même avec le bon mot de passe, mais pas depuis une autre IP.
        assert!(c.verifier("joueur", "motdepasse1", "3.3.3.3").is_err());
        assert!(c.verifier("joueur", "motdepasse1", "4.4.4.4").is_ok());
    }
}
