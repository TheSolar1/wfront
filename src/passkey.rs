// ══════════════════════════════════════════════════════════════════
// passkey.rs — Cles d'acces (WebAuthn) pour l'administration
//
// La cle privee est creee et gardee par l'appareil (Windows Hello,
// telephone, cle USB de securite) et n'en sort jamais : on ne televerse
// plus aucun fichier. Le serveur ne stocke que la CLE PUBLIQUE (format
// SPKI) de chaque cle d'acces enregistree, dans data/admin_passkeys.json.
//
// Enregistrement : seulement par quelqu'un deja admin (cle .pem ou autre
// cle d'acces). Connexion : le navigateur signe un defi du serveur ;
// on verifie l'origine, le site (rpId), la presence de l'utilisateur et la
// signature (ES256, EdDSA ou RS256 selon l'appareil).
// ══════════════════════════════════════════════════════════════════

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64URL, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize, Clone)]
pub struct CleAcces {
    /// Identifiant de la cle chez l'appareil (base64url).
    pub id: String,
    /// Algorithme COSE : -7 ES256, -8 EdDSA, -257 RS256.
    pub alg: i64,
    /// Cle publique au format SPKI DER (base64url).
    pub spki: String,
    pub nom: String,
    pub cree: i64,
}

pub fn b64url(s: &str) -> Result<Vec<u8>, String> {
    B64URL.decode(s.trim_end_matches('=')).map_err(|_| "Donnée illisible.".to_string())
}

/// Verifie clientDataJSON : type, defi et origine attendus. Rend le defi lu.
pub fn verifier_client(client: &[u8], type_attendu: &str, origine: &str) -> Result<String, String> {
    let v: Value = serde_json::from_slice(client).map_err(|_| "Réponse de l'appareil illisible.")?;
    if v["type"].as_str() != Some(type_attendu) {
        return Err("Réponse de l'appareil inattendue.".into());
    }
    if v["origin"].as_str() != Some(origine) {
        return Err(format!("Origine refusée ({}).", v["origin"].as_str().unwrap_or("?")));
    }
    v["challenge"].as_str().map(|s| s.to_string()).ok_or_else(|| "Défi manquant.".into())
}

/// Verifie une connexion : donnees de l'authentificateur (site, presence)
/// et signature de (authenticatorData || SHA-256(clientDataJSON)).
pub fn verifier_assertion(cle: &CleAcces, rp_id: &str, auth: &[u8], client: &[u8], sig: &[u8]) -> Result<(), String> {
    if auth.len() < 37 {
        return Err("Données de l'appareil trop courtes.".into());
    }
    if auth[..32] != Sha256::digest(rp_id.as_bytes())[..] {
        return Err("Cette clé d'accès appartient à un autre site.".into());
    }
    if auth[32] & 0x01 == 0 {
        return Err("Présence de l'utilisateur non confirmée.".into());
    }
    let mut message = auth.to_vec();
    message.extend_from_slice(&Sha256::digest(client));
    let spki = b64url(&cle.spki)?;
    match cle.alg {
        -7 => {
            use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
            use p256::pkcs8::DecodePublicKey;
            let k = VerifyingKey::from_public_key_der(&spki).map_err(|_| "Clé publique invalide.")?;
            let s = Signature::from_der(sig).map_err(|_| "Signature illisible.")?;
            k.verify(&message, &s).map_err(|_| "Signature refusée.".into())
        }
        -8 => {
            use ed25519_dalek::{Signature, Verifier, VerifyingKey};
            let brut: [u8; 32] = spki.get(spki.len().saturating_sub(32)..).and_then(|b| b.try_into().ok()).ok_or("Clé publique invalide.")?;
            let k = VerifyingKey::from_bytes(&brut).map_err(|_| "Clé publique invalide.")?;
            let s: [u8; 64] = sig.try_into().map_err(|_| "Signature illisible.")?;
            k.verify(&message, &Signature::from_bytes(&s)).map_err(|_| "Signature refusée.".into())
        }
        -257 => {
            use rsa::pkcs1v15::{Signature, VerifyingKey};
            use rsa::pkcs8::DecodePublicKey;
            use rsa::signature::Verifier;
            let pk = rsa::RsaPublicKey::from_public_key_der(&spki).map_err(|_| "Clé publique invalide.")?;
            let k = VerifyingKey::<Sha256>::new(pk);
            let s = Signature::try_from(sig).map_err(|_| "Signature illisible.")?;
            k.verify(&message, &s).map_err(|_| "Signature refusée.".into())
        }
        _ => Err("Algorithme de clé non pris en charge.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};
    use p256::pkcs8::EncodePublicKey;

    /// Simule un appareil ES256 : seule une signature valide, pour le bon
    /// site et le bon contenu, est acceptee.
    #[test]
    fn assertion_es256() {
        let sk = SigningKey::from_bytes(&[3u8; 32].into()).unwrap();
        let spki = sk.verifying_key().to_public_key_der().unwrap();
        let cle = CleAcces { id: "x".into(), alg: -7, spki: B64URL.encode(spki.as_bytes()), nom: "test".into(), cree: 0 };
        let mut auth = Sha256::digest(b"localhost").to_vec();
        auth.push(0x05); // presence + verification
        auth.extend_from_slice(&[0, 0, 0, 1]);
        let client = br#"{"type":"webauthn.get","challenge":"abc","origin":"http://localhost:8095"}"#;
        let mut msg = auth.clone();
        msg.extend_from_slice(&Sha256::digest(client));
        let sig: p256::ecdsa::Signature = sk.sign(&msg);
        let der = sig.to_der();
        assert!(verifier_assertion(&cle, "localhost", &auth, client, der.as_bytes()).is_ok());
        assert!(verifier_assertion(&cle, "autre.site", &auth, client, der.as_bytes()).is_err(), "mauvais site");
        let faux = br#"{"type":"webauthn.get","challenge":"zzz","origin":"http://localhost:8095"}"#;
        assert!(verifier_assertion(&cle, "localhost", &auth, faux, der.as_bytes()).is_err(), "contenu modifie");
        assert_eq!(verifier_client(client, "webauthn.get", "http://localhost:8095").unwrap(), "abc");
        assert!(verifier_client(client, "webauthn.get", "http://pirate.org").is_err());
    }
}
