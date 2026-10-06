// ══════════════════════════════════════════════════════════════════
// WorldFront — serveur
// Processus independant de VEX (son propre port), qui reutilise la
// connexion VEX : le cookie `connexion_cookie` pose par VEX est relu
// ici et verifie dans la base VEX exactement comme c::verifier_session
// (cookie + IP + navigateur + anciennete < 1 h). Aucune ecriture n'est
// faite dans la base VEX.
//
// Temps reel : WebSocket /ws, un tick de simulation par seconde, chaque
// client recoit sa propre vue (vue.rs).
// ══════════════════════════════════════════════════════════════════

mod admin;
mod bots;
mod defs;
mod fabrication;
mod front;
mod jeu;
mod monde;
mod passkey;
mod reseau;
mod vue;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use mysql::prelude::Queryable;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
#[derive(Deserialize, Clone)]
#[serde(default)]
struct Config {
    adresse: String,
    port: u16,
    /// URL publique de VEX (liens de la barre de navigation, page de connexion).
    /// Vide si WorldFront est servi sur le meme domaine que VEX.
    vex_url: String,
    /// Chemin sous lequel le reverse proxy expose WorldFront (ex. "/worldfront"),
    /// utilise pour les redirections. Vide si WorldFront est a la racine.
    prefixe: String,
    /// "reseau" (defaut) : « Se connecter avec VEX » depuis n'importe quel nœud
    /// du reseau VEX. "vex" : sessions lues dans la base d'un seul nœud.
    /// "dev" : simple pseudo, pour tester en local.
    auth: String,
    /// Adresse publique de WorldFront, prefixe compris (ex.
    /// "https://jeu.exemple.org"). Vide : deduite de l'en-tete Host.
    url_publique: String,
    /// Annuaire du reseau VEX : seuls les nœuds qui y figurent sont acceptes.
    /// Vide : tout serveur VEX joignable est accepte.
    annuaire_url: String,
    /// Nœud propose par defaut sur la page de connexion.
    noeud_par_defaut: String,
    /// Chemin du db.json de VEX (memes identifiants MySQL que VEX).
    vex_db_fichier: String,
    vex_db: Option<DbConf>,
    session_duree_s: i64,
    verifier_ip: bool,
    verifier_navigateur: bool,
    /// Si WorldFront est derriere un reverse proxy : lire X-Forwarded-For.
    proxy_de_confiance: bool,
    /// Privilege maximal pour les outils d'administration du jeu. Depuis la
    /// cle d'administration, seul son detenteur a le privilege 1.
    admin_privilege_max: i64,
    /// Comptes VEX administrateurs du jeu : « user_id@node_id » en mode
    /// reseau, ou l'e-mail du compte en mode vex (visible sur /admin). Ils ont
    /// l'administration des qu'ils sont connectes, sans cle ni code.
    admins: Vec<String>,
    /// Autoriser a jouer sans compte VEX (pseudo, session « invite »).
    invites: bool,
    /// Cle publique Ed25519 (32 octets en base64) de la cle d'administration.
    /// Seul le detenteur de la cle privee correspondante voit et utilise
    /// l'administration (page /admin). Vide : administration desactivee.
    admin_cle_publique: String,
    carte_largeur: usize,
    carte_hauteur: usize,
    /// Graine de la carte. 0 (defaut) : tiree au hasard a chaque nouveau monde.
    graine: u64,
    /// Multiplicateur de vitesse du jeu (1 = normal).
    vitesse: f64,
    protection_heures: f64,
    sauvegarde: String,
    intervalle_sauvegarde_s: u64,
    /// Nombre de nations jouees par l'ordinateur (0 = aucune).
    bots: usize,
}

#[derive(Deserialize, Clone, Default)]
struct DbConf {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            adresse: "0.0.0.0".into(),
            port: 8095,
            vex_url: "http://127.0.0.1:8080".into(),
            prefixe: String::new(),
            auth: "reseau".into(),
            url_publique: String::new(),
            annuaire_url: "https://vex.hopto.org/neut/annuaire".into(),
            noeud_par_defaut: "vex.hopto.org".into(),
            vex_db_fichier: String::new(),
            vex_db: None,
            session_duree_s: 3600,
            verifier_ip: true,
            verifier_navigateur: true,
            proxy_de_confiance: false,
            admin_privilege_max: 3,
            admin_cle_publique: String::new(),
            admins: Vec::new(),
            invites: true,
            carte_largeur: 128,
            carte_hauteur: 80,
            graine: 0,
            vitesse: 1.0,
            protection_heures: 2.0,
            sauvegarde: "data/monde.json".into(),
            intervalle_sauvegarde_s: 30,
            bots: 6,
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// Etat partage
// ══════════════════════════════════════════════════════════════════
#[derive(Clone)]
struct Identite {
    user_id: i64,
    nom: String,
    privilege: i64,
    /// Rang VEX du compte (1 fondateur … 10 aucun) : couleur du nom dans la
    /// barre, comme sur VEX. Sans lien avec l'administration de WorldFront.
    rang_vex: i64,
    sombre: bool,
    /// Nœud VEX de l'utilisateur (mode reseau) : cible des liens VEX.
    noeud: Option<String>,
    /// Compte reseau « user_id@node_id » (ou « invite:... »).
    compte: Option<String>,
}

struct Client {
    user_id: i64,
    tx: mpsc::UnboundedSender<String>,
    suivi: vue::Suivi,
}

struct App {
    cfg: Config,
    racine: PathBuf,
    monde: Mutex<monde::Monde>,
    clients: Mutex<HashMap<u64, Client>>,
    prochain_client: AtomicU64,
    db: Option<mysql::Pool>,
    reseau: reseau::Reseau,
    regles: jeu::Regles,
    admin: admin::Admin,
}

type Partage = Arc<App>;

// ══════════════════════════════════════════════════════════════════
// Demarrage
// ══════════════════════════════════════════════════════════════════
fn trouver_racine() -> PathBuf {
    let candidats = [
        std::env::current_dir().ok(),
        std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())),
        std::env::current_exe().ok().and_then(|p| p.parent()?.parent()?.parent().map(|p| p.to_path_buf())),
    ];
    for c in candidats.into_iter().flatten() {
        if c.join("static").join("jeu.html").exists() {
            return c;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn charger_config(racine: &Path) -> Config {
    let chemin = racine.join("config.json");
    match std::fs::read_to_string(&chemin) {
        Ok(t) => match serde_json::from_str::<Config>(&t) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[config] config.json invalide ({}), valeurs par defaut utilisees.", e);
                Config::default()
            }
        },
        Err(_) => {
            eprintln!("[config] config.json absent : valeurs par defaut (voir config.example.json).");
            Config::default()
        }
    }
}

fn pool_vex(cfg: &Config, racine: &Path) -> Option<mysql::Pool> {
    let conf = match &cfg.vex_db {
        Some(c) => c.clone(),
        None => {
            if cfg.vex_db_fichier.is_empty() {
                eprintln!("[auth] ni vex_db ni vex_db_fichier dans config.json.");
                return None;
            }
            let p = racine.join(&cfg.vex_db_fichier);
            let t = std::fs::read_to_string(&p)
                .map_err(|e| eprintln!("[auth] lecture de {} impossible : {}", p.display(), e))
                .ok()?;
            serde_json::from_str::<DbConf>(&t)
                .map_err(|e| eprintln!("[auth] {} invalide : {}", p.display(), e))
                .ok()?
        }
    };
    let opts = mysql::OptsBuilder::new()
        .ip_or_hostname(Some(conf.host.clone()))
        .tcp_port(if conf.port == 0 { 3306 } else { conf.port })
        .user(Some(conf.user.clone()))
        .pass(Some(conf.password.clone()))
        .db_name(Some(conf.database.clone()))
        .pool_opts(mysql::PoolOpts::default().with_constraints(mysql::PoolConstraints::new(0, 4).unwrap()));
    match mysql::Pool::new(opts) {
        Ok(p) => {
            println!("[auth] base VEX joignable ({}:{}/{}).", conf.host, conf.port, conf.database);
            Some(p)
        }
        Err(e) => {
            eprintln!("[auth] connexion a la base VEX impossible : {}", e);
            None
        }
    }
}

fn charger_monde(cfg: &Config, racine: &Path) -> monde::Monde {
    let chemin = racine.join(&cfg.sauvegarde);
    if let Ok(t) = std::fs::read_to_string(&chemin) {
        match serde_json::from_str::<monde::Monde>(&t) {
            Ok(mut m) => {
                jeu::migrer(&mut m);
                println!("[monde] sauvegarde chargee : {} pays, {} armees.", m.pays.len(), m.armees.len());
                return m;
            }
            Err(e) => {
                let copie = chemin.with_extension("illisible.json");
                let _ = std::fs::copy(&chemin, &copie);
                eprintln!("[monde] sauvegarde illisible ({}), copiee dans {} ; nouveau monde.", e, copie.display());
            }
        }
    }
    let graine = graine_carte(cfg);
    println!("[monde] generation d'une carte {}x{} (graine {}).", cfg.carte_largeur, cfg.carte_hauteur, graine);
    monde::Monde::generer(cfg.carte_largeur.clamp(30, 200), cfg.carte_hauteur.clamp(20, 140), graine)
}

/// Graine de config.json, ou une graine au hasard si elle vaut 0.
fn graine_carte(cfg: &Config) -> u64 {
    if cfg.graine != 0 {
        cfg.graine
    } else {
        use rand::Rng;
        rand::thread_rng().gen_range(1..u32::MAX as u64)
    }
}

async fn sauvegarder(app: &Partage) {
    let texte = {
        let m = app.monde.lock().unwrap();
        match serde_json::to_string(&*m) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[sauvegarde] serialisation impossible : {}", e);
                return;
            }
        }
    };
    let chemin = app.racine.join(&app.cfg.sauvegarde);
    if let Some(d) = chemin.parent() {
        let _ = tokio::fs::create_dir_all(d).await;
    }
    let tmp = chemin.with_extension("tmp");
    if let Err(e) = tokio::fs::write(&tmp, texte).await {
        eprintln!("[sauvegarde] ecriture impossible : {}", e);
        return;
    }
    if let Err(e) = tokio::fs::rename(&tmp, &chemin).await {
        eprintln!("[sauvegarde] renommage impossible : {}", e);
    }
}

#[tokio::main]
async fn main() {
    let racine = trouver_racine();
    let cfg = charger_config(&racine);
    if std::env::args().any(|a| a == "--apercu") {
        apercu_carte(&cfg);
        return;
    }
    let db = if cfg.auth == "vex" { pool_vex(&cfg, &racine) } else { None };
    match cfg.auth.as_str() {
        "dev" => println!("[auth] MODE DEV : connexion par simple pseudo, ne pas exposer en production."),
        "reseau" => println!(
            "[auth] « Se connecter avec VEX » (annuaire : {}).",
            if cfg.annuaire_url.is_empty() { "non vérifié" } else { cfg.annuaire_url.as_str() }
        ),
        _ => {}
    }
    let monde = charger_monde(&cfg, &racine);
    let regles = jeu::Regles {
        protection_s: (cfg.protection_heures * 3600.0) as i64,
        vitesse: cfg.vitesse.clamp(0.1, 100.0),
    };
    let app: Partage = Arc::new(App {
        cfg: cfg.clone(),
        racine: racine.clone(),
        monde: Mutex::new(monde),
        clients: Mutex::new(HashMap::new()),
        prochain_client: AtomicU64::new(1),
        db,
        reseau: reseau::Reseau::charger(racine.join("data").join("sessions.json")),
        regles,
        admin: admin::Admin::charger(racine.join("data")),
    });
    if cfg.admin_cle_publique.trim().is_empty() {
        println!("[admin] pas de admin_cle_publique (fichier .pem) : utilisez le code de recuperation ou une cle d'acces.");
    }

    // Boucle de simulation
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_millis(1000));
            let mut dernier = Instant::now();
            let mut n: u64 = 0;
            loop {
                iv.tick().await;
                let dt = dernier.elapsed().as_secs_f64().min(5.0);
                dernier = Instant::now();
                n += 1;
                boucle(&app, dt * app.cfg.vitesse.clamp(0.1, 100.0), n % 3 == 0);
            }
        });
    }
    // Sauvegarde periodique
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(app.cfg.intervalle_sauvegarde_s.max(5)));
            iv.tick().await;
            loop {
                iv.tick().await;
                sauvegarder(&app).await;
            }
        });
    }
    // Sauvegarde a l'arret (Ctrl+C, ou `kill` sur le Pi)
    {
        let app = app.clone();
        tokio::spawn(async move {
            signal_arret().await;
            println!("[monde] arret demande, sauvegarde...");
            sauvegarder(&app).await;
            std::process::exit(0);
        });
    }

    let routes = Router::new()
        .route("/", get(page_accueil))
        .route("/jeu", get(page_jeu))
        .route("/dev", get(page_dev))
        .route("/dev/entrer", get(dev_entrer))
        .route("/dev/sortir", get(dev_sortir))
        .route("/connexion", get(page_connexion))
        .route("/auth/debut", get(auth_debut))
        .route("/auth/retour", get(auth_retour))
        .route("/invite/entrer", get(invite_entrer))
        .route("/deconnexion", get(deconnexion))
        .route("/api/statut", get(api_statut))
        .route("/admin", get(page_admin))
        .route("/admin/defi", get(admin_defi))
        .route("/admin/prouver", post(admin_prouver))
        .route("/admin/sortir", get(admin_sortir))
        .route("/admin/code", post(admin_code))
        .route("/admin/passkey/options", get(passkey_options))
        .route("/admin/passkey/enregistrer", post(passkey_enregistrer))
        .route("/admin/passkey/prouver", post(passkey_prouver))
        .route("/admin/passkey/supprimer", post(passkey_supprimer))
        .route("/ws", get(ws))
        .nest_service("/static", ServeDir::new(racine.join("static")))
        // Sans ca, le navigateur garde d'anciennes versions des .css/.js apres
        // une mise a jour : il revalide maintenant chaque fichier (304 si
        // inchange, donc presque gratuit). Les pages gardent leur no-store.
        .layer(SetResponseHeaderLayer::if_not_present(header::CACHE_CONTROL, header::HeaderValue::from_static("no-cache")))
        .with_state(app.clone());

    let adr = format!("{}:{}", cfg.adresse, cfg.port);
    let ecoute = match tokio::net::TcpListener::bind(&adr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Impossible d'ecouter sur {} : {}", adr, e);
            std::process::exit(1);
        }
    };
    println!("WorldFront en ligne sur http://{}  (VEX : {})", adr, cfg.vex_url);
    axum::serve(ecoute, routes.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .unwrap();
}

#[cfg(unix)]
async fn signal_arret() {
    use tokio::signal::unix::{signal, SignalKind};
    match signal(SignalKind::terminate()) {
        Ok(mut term) => {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        }
        Err(_) => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}

#[cfg(not(unix))]
async fn signal_arret() {
    let _ = tokio::signal::ctrl_c().await;
}

/// `worldfront --apercu` : dessine la carte en texte (reglage de la graine).
fn apercu_carte(cfg: &Config) {
    let graine = graine_carte(cfg);
    println!("graine {}", graine);
    let m = monde::Monde::generer(cfg.carte_largeur, cfg.carte_hauteur, graine);
    let mut compte = [0usize; 8];
    let mut depots = [0usize; 6];
    for y in 0..m.hauteur {
        let mut ligne = String::new();
        if y % 2 == 1 {
            ligne.push(' ');
        }
        for x in 0..m.largeur {
            let c = &m.cases[y * m.largeur + x];
            compte[c.terrain as usize] += 1;
            depots[c.depot as usize] += 1;
            ligne.push(match c.depot {
                1 => 'P',
                2 => 'M',
                3 => 'U',
                4 => 'R',
                _ => ['~', '-', '.', 'f', 'n', '^', 's', 't'][c.terrain as usize],
            });
            ligne.push(' ');
        }
        println!("{}", ligne);
    }
    for (i, t) in defs::TERRAINS.iter().enumerate() {
        println!("{:>12} : {}", t.nom, compte[i]);
    }
    for (i, d) in defs::DEPOTS.iter().enumerate().skip(1) {
        println!("{:>20} : {}", d.nom, depots[i]);
    }
}

/// Un tick : simulation puis envoi de sa vue a chaque client.
fn boucle(app: &Partage, dt: f64, avec_publics: bool) {
    let mut m = app.monde.lock().unwrap();
    let bl = jeu::tick(&mut m, dt);
    let nb_bots = m.bots_admin.unwrap_or(app.cfg.bots);
    if nb_bots > 0 {
        bots::jouer(&mut m, &app.regles, &bl, dt);
    }
    bots::assurer(&mut m, nb_bots, &app.regles, dt);
    let vis = vue::visions(&m, &bl);
    let publics = vue::publics(&m, &bl);
    {
        let mut clients = app.clients.lock().unwrap();
        for c in clients.values_mut() {
            let pid = jeu::pays_du_joueur(&m, c.user_id);
            let ctx = vue::Contexte {
                m: &m,
                bl: &bl,
                vis: &vis,
                publics: if avec_publics || !c.suivi.premier { Some(&publics) } else { None },
            };
            let msg = vue::etat(&ctx, pid, &mut c.suivi);
            let _ = c.tx.send(msg);
        }
    }
    m.effets.clear();
}

// ══════════════════════════════════════════════════════════════════
// Authentification (session VEX)
// ══════════════════════════════════════════════════════════════════
fn cookie(headers: &HeaderMap, nom: &str) -> String {
    for v in headers.get_all(header::COOKIE) {
        let Ok(s) = v.to_str() else { continue };
        for part in s.split(';') {
            let mut kv = part.trim().splitn(2, '=');
            if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                if k.trim() == nom {
                    return v.trim().to_string();
                }
            }
        }
    }
    String::new()
}

/// Meme logique que utils::strip_port cote VEX.
fn sans_port(adr: &str) -> String {
    if adr.starts_with('[') {
        if let Some(fin) = adr.find(']') {
            return adr[1..fin].to_string();
        }
    }
    if let Some(pos) = adr.rfind(':') {
        let avant = &adr[..pos];
        if !avant.contains(':') {
            return avant.to_string();
        }
    }
    adr.to_string()
}

fn ip_client(app: &App, headers: &HeaderMap, addr: SocketAddr) -> String {
    if app.cfg.proxy_de_confiance {
        if let Some(x) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(premiere) = x.split(',').next() {
                return premiere.trim().to_string();
            }
        }
    }
    let ip = addr.ip();
    // IPv4 mappee en IPv6 (::ffff:1.2.3.4) -> 1.2.3.4, comme tiny_http cote VEX.
    match ip {
        std::net::IpAddr::V6(v6) => v6.to_ipv4_mapped().map(|v4| v4.to_string()).unwrap_or_else(|| v6.to_string()),
        std::net::IpAddr::V4(v4) => v4.to_string(),
    }
}

fn session_recente(date: &str, duree: i64) -> bool {
    let Ok(naive) = chrono::NaiveDateTime::parse_from_str(date, "%Y-%m-%d %H:%M:%S") else { return false };
    let diff = chrono::Local::now().naive_local().signed_duration_since(naive).num_seconds();
    diff >= 0 && diff < duree
}

fn verifier_vex(pool: &mysql::Pool, cfg: &Config, jeton: &str, ip: &str, ua: &str) -> Option<Identite> {
    let mut conn = pool.get_conn().map_err(|e| eprintln!("[auth] base VEX : {}", e)).ok()?;
    let ligne: Option<(String, String, String, String, String)> = conn
        .exec_first(
            "SELECT DATE_FORMAT(datecra, '%Y-%m-%d %H:%i:%s'), pc, navi, email, nom \
             FROM loginc WHERE idcokier = ? LIMIT 1",
            (jeton,),
        )
        .map_err(|e| eprintln!("[auth] requete loginc : {}", e))
        .ok()?;
    let (date, pc, navi, email, nom) = ligne?;
    if cfg.verifier_ip && sans_port(&pc) != ip {
        return None;
    }
    if cfg.verifier_navigateur && navi != ua {
        return None;
    }
    if !session_recente(&date, cfg.session_duree_s) {
        return None;
    }
    let compte: Option<(i64, Option<i64>)> = conn
        .exec_first("SELECT id, privilege FROM login WHERE email = ? LIMIT 1", (&email,))
        .ok()?;
    let (id, privilege) = compte?;
    let teme: Option<Option<i64>> = conn
        .exec_first("SELECT teme FROM pref WHERE `id-user` = ? LIMIT 1", (id,))
        .unwrap_or(None);
    Some(Identite {
        user_id: id,
        nom,
        privilege: privilege.unwrap_or(10),
        rang_vex: privilege.unwrap_or(10),
        sombre: teme.flatten().unwrap_or(0) == 1,
        noeud: None,
        // Meme serveur que VEX : le compte est reconnu par son e-mail
        // (pour la liste « admins » de config.json).
        compte: Some(email),
    })
}

fn hash_nom(nom: &str) -> i64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in nom.to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    // Negatif : jamais en collision avec un id VEX.
    -((h % 1_000_000_000) as i64) - 1
}

fn decoder_url(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let Ok(x) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(x);
                    i += 2;
                } else {
                    out.push(b'%');
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Identite du visiteur. Le privilege d'administration ne vient QUE de la
/// cle d'administration (cookie wf_admin obtenu sur /admin), jamais du mode
/// d'authentification ni du privilege VEX.
async fn authentifier(app: &Partage, headers: &HeaderMap, addr: SocketAddr) -> Option<Identite> {
    let mut id = identifier(app, headers, addr).await?;
    let compte_admin = id.compte.as_ref().map(|c| app.cfg.admins.iter().any(|a| a.trim().eq_ignore_ascii_case(c))).unwrap_or(false);
    // Un invite (sans compte VEX) n'a jamais l'administration.
    let invite = id.compte.as_deref().map(|c| c.starts_with("invite:")).unwrap_or(false);
    id.privilege = if !invite && (compte_admin || app.admin.valide(&cookie(headers, "wf_admin"), id.user_id)) { 1 } else { 10 };
    Some(id)
}

async fn identifier(app: &Partage, headers: &HeaderMap, addr: SocketAddr) -> Option<Identite> {
    if app.cfg.auth == "dev" {
        let nom = decoder_url(&cookie(headers, "wf_dev"));
        let nom: String = nom.chars().filter(|c| !c.is_control()).take(24).collect();
        if nom.trim().len() < 2 {
            return None;
        }
        let sombre = cookie(headers, "wf_theme") == "dark";
        return Some(Identite { user_id: hash_nom(&nom), nom, privilege: 1, rang_vex: 10, sombre, noeud: None, compte: None });
    }
    if app.cfg.auth == "reseau" {
        let s = app.reseau.session(&cookie(headers, "wf_session"))?;
        return Some(Identite {
            user_id: reseau::id_compte(&s.compte),
            nom: s.nom,
            privilege: 10,
            rang_vex: 10,
            sombre: s.sombre,
            noeud: if s.noeud.is_empty() { None } else { Some(s.noeud) },
            compte: Some(s.compte),
        });
    }
    let pool = app.db.clone()?;
    let jeton = cookie(headers, "connexion_cookie");
    if jeton.is_empty() {
        return None;
    }
    let ip = ip_client(app, headers, addr);
    let ua = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let cfg = app.cfg.clone();
    tokio::task::spawn_blocking(move || verifier_vex(&pool, &cfg, &jeton, &ip, &ua))
        .await
        .ok()
        .flatten()
}

/// Change a chaque demarrage : ajoute aux liens des .css/.js (?v=) pour que
/// le navigateur recharge tout apres une mise a jour du serveur.
static VERSION_FICHIERS: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn echapper(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// Chemin public d'une page de WorldFront (tient compte du prefixe du proxy).
fn chemin(app: &App, page: &str) -> String {
    format!("{}{}", app.cfg.prefixe.trim_end_matches('/'), page)
}

fn url_connexion(app: &App) -> String {
    if app.cfg.auth == "dev" {
        chemin(app, "/dev")
    } else if app.cfg.auth == "reseau" {
        chemin(app, "/connexion")
    } else {
        // Meme serveur que VEX : sa page de connexion, puis retour au jeu
        // (`next` n'accepte qu'un chemin local, voir login.html de VEX).
        format!("{}/login?next={}", app.cfg.vex_url.trim_end_matches('/'), reseau::encoder(&chemin(app, "/jeu")))
    }
}

/// Nom dans la barre du haut, comme build_nav_html() de VEX : nom anime
/// pour le fondateur, couleur du rang pour les rangs 2 a 9.
fn nom_barre(id: Option<&Identite>) -> String {
    let nom = echapper(id.map(|i| i.nom.as_str()).unwrap_or(""));
    let (titre, couleur) = match id.map(|i| i.rang_vex).unwrap_or(10) {
        1 => return format!("<span class=\"user-name-top-7844 fona\" title=\"fondateur\">{}</span>", nom),
        2 => ("super admin", "#6d0000"),
        3 => ("admin", "#d30000"),
        4 => ("verfircateur", "#4169e1"),
        5 => ("Super-moderateur", "#4169e1"),
        6 => ("Moderateur", "#006400"),
        7 => ("", "#32cd32"),
        8 => ("utilisateur certifie", "#4b4b4b"),
        9 => ("beta-testeur", "#20012a"),
        _ => return format!("<span class=\"user-name-top-7844\">{}</span>", nom),
    };
    format!("<span class=\"user-name-top-7844\" style=\"color:{}!important\" title=\"{}\">{}</span>", couleur, titre, nom)
}

fn gabarit(app: &App, fichier: &str, id: Option<&Identite>) -> Response {
    let chemin = app.racine.join("static").join(fichier);
    let Ok(html) = std::fs::read_to_string(&chemin) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Page introuvable : {}", chemin.display())).into_response();
    };
    let theme = if id.map(|i| i.sombre).unwrap_or(false) { "dark" } else { "light" };
    // Liens VEX (grille d'applis, compte) : vers le nœud de l'utilisateur.
    let vex = id
        .and_then(|i| i.noeud.clone())
        .unwrap_or_else(|| app.cfg.vex_url.clone());
    let html = html
        .replace("__P__", &echapper(app.cfg.prefixe.trim_end_matches('/')))
        .replace("__THEME__", theme)
        .replace("__VEX__", &echapper(vex.trim_end_matches('/')))
        .replace("__NOEUD_DEFAUT__", &echapper(&app.cfg.noeud_par_defaut))
        .replace("__CONNEXION__", &echapper(&url_connexion(app)))
        .replace("__ENTREE__", &echapper(&url_entree(app)))
        .replace("__INVITE__", if id.and_then(|i| i.compte.as_deref()).map(|c| c.starts_with("invite:")).unwrap_or(false) { "1" } else { "0" })
        .replace("__VEX_DIRECT__", &echapper(&format!("{}/auth/debut?noeud={}", app.cfg.prefixe.trim_end_matches('/'), reseau::encoder(&app.cfg.noeud_par_defaut))))
        .replace("__INVITES__", if app.cfg.invites { "1" } else { "0" })
        .replace("__COMPTE__", &echapper(id.and_then(|i| i.compte.as_deref()).unwrap_or("")))
        .replace("__NOM_TOP__", &nom_barre(id))
        .replace("__NOM__", &echapper(id.map(|i| i.nom.as_str()).unwrap_or("")))
        .replace("__CONNECTE__", if id.is_some() { "1" } else { "0" })
        .replace("__MODE__", &echapper(&app.cfg.auth))
        .replace("__V__", VERSION_FICHIERS.get_or_init(|| chrono::Utc::now().timestamp().to_string()))
        .replace(
            "__ADMIN__",
            if id.map(|i| i.privilege <= app.cfg.admin_privilege_max).unwrap_or(false) { "1" } else { "0" },
        );
    (
        [(header::CACHE_CONTROL, "no-store")],
        Html(html),
    )
        .into_response()
}

// ══════════════════════════════════════════════════════════════════
// Routes HTTP
// ══════════════════════════════════════════════════════════════════
async fn page_accueil(State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap) -> Response {
    let id = authentifier(&app, &headers, addr).await;
    gabarit(&app, "accueil.html", id.as_ref())
}

async fn page_jeu(State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap) -> Response {
    match authentifier(&app, &headers, addr).await {
        Some(id) => gabarit(&app, "jeu.html", Some(&id)),
        None => Redirect::to(&url_entree(&app)).into_response(),
    }
}

/// Connexion en un clic : en mode reseau, droit vers le nœud VEX par defaut
/// (la page /connexion reste la pour choisir un autre nœud).
fn url_entree(app: &App) -> String {
    if app.cfg.auth == "reseau" && app.cfg.invites {
        chemin(app, "/connexion")
    } else if app.cfg.auth == "reseau" && !app.cfg.noeud_par_defaut.is_empty() {
        format!("{}?noeud={}", chemin(app, "/auth/debut"), reseau::encoder(&app.cfg.noeud_par_defaut))
    } else {
        url_connexion(app)
    }
}

async fn page_dev(State(app): State<Partage>) -> Response {
    if app.cfg.auth != "dev" {
        return Redirect::to(&chemin(&app, "/")).into_response();
    }
    gabarit(&app, "dev.html", None)
}

#[derive(Deserialize)]
struct DevParams {
    nom: String,
    #[serde(default)]
    theme: String,
}

async fn dev_entrer(State(app): State<Partage>, Query(q): Query<DevParams>) -> Response {
    if app.cfg.auth != "dev" {
        return Redirect::to(&chemin(&app, "/")).into_response();
    }
    let nom: String = q.nom.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').take(24).collect();
    if nom.len() < 2 {
        return Redirect::to(&chemin(&app, "/dev")).into_response();
    }
    let theme = if q.theme == "dark" { "dark" } else { "light" };
    let mut r = Redirect::to(&chemin(&app, "/jeu")).into_response();
    let h = r.headers_mut();
    h.append(header::SET_COOKIE, format!("wf_dev={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000", nom).parse().unwrap());
    h.append(header::SET_COOKIE, format!("wf_theme={}; Path=/; SameSite=Lax; Max-Age=2592000", theme).parse().unwrap());
    r
}

async fn dev_sortir(State(app): State<Partage>) -> Response {
    let mut r = Redirect::to(&chemin(&app, "/")).into_response();
    r.headers_mut().append(header::SET_COOKIE, "wf_dev=; Path=/; Max-Age=0".parse().unwrap());
    r
}

// ── « Se connecter avec VEX » ─────────────────────────────────────
/// Adresse absolue de /auth/retour, transmise au nœud VEX.
fn url_retour(app: &App, headers: &HeaderMap) -> String {
    if !app.cfg.url_publique.is_empty() {
        return format!("{}/auth/retour", app.cfg.url_publique.trim_end_matches('/'));
    }
    let hote = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("127.0.0.1");
    let schema = if app.cfg.proxy_de_confiance {
        headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()).unwrap_or("http")
    } else {
        "http"
    };
    format!("{}://{}{}", schema, hote, chemin(app, "/auth/retour"))
}

async fn page_connexion(State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap) -> Response {
    if app.cfg.auth != "reseau" {
        return Redirect::to(&url_connexion(&app)).into_response();
    }
    if authentifier(&app, &headers, addr).await.is_some() {
        return Redirect::to(&chemin(&app, "/jeu")).into_response();
    }
    gabarit(&app, "connexion.html", None)
}

#[derive(Deserialize)]
struct DebutParams {
    #[serde(default)]
    noeud: String,
}

async fn auth_debut(State(app): State<Partage>, headers: HeaderMap, Query(q): Query<DebutParams>) -> Response {
    if app.cfg.auth != "reseau" {
        return Redirect::to(&url_connexion(&app)).into_response();
    }
    let retour = url_retour(&app, &headers);
    let annuaire = app.cfg.annuaire_url.clone();
    let a = app.clone();
    let res = tokio::task::spawn_blocking(move || a.reseau.debut(&q.noeud, &retour, &annuaire))
        .await
        .unwrap_or_else(|_| Err("Erreur interne.".into()));
    match res {
        Ok(url) => Redirect::to(&url).into_response(),
        Err(e) => Redirect::to(&format!("{}?erreur={}", chemin(&app, "/connexion"), reseau::encoder(&e))).into_response(),
    }
}

async fn auth_retour(State(app): State<Partage>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if app.cfg.auth != "reseau" {
        return Redirect::to(&url_connexion(&app)).into_response();
    }
    let retour = url_retour(&app, &headers);
    // Session invitee en cours : sa nation passera sur le compte VEX.
    let ancienne = app.reseau.session(&cookie(&headers, "wf_session")).filter(|s| s.compte.starts_with("invite:"));
    match app.reseau.retour(&q, &retour) {
        Ok((jeton, s)) => {
            println!("[auth] connexion de {} ({}) via {}", s.nom, s.compte, s.noeud);
            if let Some(inv) = ancienne {
                let (de, vers) = (reseau::id_compte(&inv.compte), reseau::id_compte(&s.compte));
                let mut m = app.monde.lock().unwrap();
                if jeu::pays_du_joueur(&m, vers).is_none() {
                    if let Some(pid) = jeu::pays_du_joueur(&m, de) {
                        let p = m.pays.get_mut(&pid).unwrap();
                        p.user_id = vers;
                        p.joueur = s.nom.clone();
                        println!("[auth] la nation de l'invite {} passe sur le compte {}", inv.nom, s.compte);
                    }
                }
                drop(m);
                app.reseau.fermer(&cookie(&headers, "wf_session"));
            }
            let secure = if retour.starts_with("https://") { "; Secure" } else { "" };
            let mut r = Redirect::to(&chemin(&app, "/jeu")).into_response();
            r.headers_mut().append(
                header::SET_COOKIE,
                format!("wf_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}", jeton, reseau::DUREE_SESSION, secure)
                    .parse()
                    .unwrap(),
            );
            r
        }
        Err(e) => Redirect::to(&format!("{}?erreur={}", chemin(&app, "/connexion"), reseau::encoder(&e))).into_response(),
    }
}

#[derive(Deserialize)]
struct InviteParams {
    #[serde(default)]
    nom: String,
    #[serde(default)]
    theme: String,
}

/// Jouer sans compte VEX : un pseudo suffit (session « invite »).
async fn invite_entrer(State(app): State<Partage>, headers: HeaderMap, Query(q): Query<InviteParams>) -> Response {
    if app.cfg.auth != "reseau" || !app.cfg.invites {
        return Redirect::to(&url_connexion(&app)).into_response();
    }
    let nom: String = q.nom.chars().filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-' | '.')).take(24).collect();
    let nom = nom.trim().to_string();
    if nom.chars().count() < 2 {
        return Redirect::to(&format!("{}?erreur={}", chemin(&app, "/connexion"), reseau::encoder("Choisissez un pseudo d'au moins 2 caractères."))).into_response();
    }
    let noeud = reseau::normaliser_noeud(&app.cfg.noeud_par_defaut).unwrap_or_default();
    let jeton = app.reseau.session_invite(&format!("{} (invité)", nom), q.theme == "dark", &noeud);
    println!("[auth] invite : {}", nom);
    let secure = if url_retour(&app, &headers).starts_with("https://") { "; Secure" } else { "" };
    let mut r = Redirect::to(&chemin(&app, "/jeu")).into_response();
    r.headers_mut().append(
        header::SET_COOKIE,
        format!("wf_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}", jeton, reseau::DUREE_SESSION, secure).parse().unwrap(),
    );
    r
}

async fn deconnexion(State(app): State<Partage>, headers: HeaderMap) -> Response {
    app.reseau.fermer(&cookie(&headers, "wf_session"));
    let mut r = Redirect::to(&chemin(&app, "/")).into_response();
    r.headers_mut().append(header::SET_COOKIE, "wf_session=; Path=/; Max-Age=0".parse().unwrap());
    r
}

// ── Administration : reservee au detenteur de la cle privee ───────
async fn page_admin(State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap) -> Response {
    match authentifier(&app, &headers, addr).await {
        Some(id) => gabarit(&app, "admin.html", Some(&id)),
        None => Redirect::to(&url_connexion(&app)).into_response(),
    }
}

async fn admin_defi(State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap) -> Response {
    let Some(id) = authentifier(&app, &headers, addr).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"erreur": "Connectez-vous d'abord."}))).into_response();
    };
    if app.cfg.admin_cle_publique.trim().is_empty() {
        return (StatusCode::FORBIDDEN, Json(json!({"erreur": "Administration désactivée sur ce serveur."}))).into_response();
    }
    Json(json!({ "message": app.admin.defi(id.user_id) })).into_response()
}

#[derive(Deserialize)]
struct Preuve {
    message: String,
    sig: String,
}

async fn admin_prouver(
    State(app): State<Partage>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(p): Json<Preuve>,
) -> Response {
    let Some(id) = authentifier(&app, &headers, addr).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"erreur": "Connectez-vous d'abord."}))).into_response();
    };
    match app.admin.prouver(&app.cfg.admin_cle_publique, id.user_id, &p.message, &p.sig) {
        Ok(jeton) => {
            println!("[admin] administration deverrouillee par {} ({})", id.nom, id.user_id);
            let mut r = Json(json!({ "ok": true })).into_response();
            r.headers_mut().append(
                header::SET_COOKIE,
                format!("wf_admin={}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}", jeton, admin::DUREE).parse().unwrap(),
            );
            r
        }
        Err(e) => {
            println!("[admin] preuve refusee pour {} ({}) : {}", id.nom, id.user_id, e);
            (StatusCode::FORBIDDEN, Json(json!({ "erreur": e }))).into_response()
        }
    }
}

// ── Cles d'acces (passkeys) : la cle privee reste dans l'appareil ──
/// Origine attendue par le navigateur et identifiant du site (rpId) : d'apres
/// url_publique, sinon l'en-tete Host. Une adresse IP (127.0.0.1) n'est pas
/// un rpId valable : il faut ouvrir le jeu via « localhost » ou un domaine.
fn origine_site(app: &App, headers: &HeaderMap) -> (String, String) {
    let origine = if !app.cfg.url_publique.is_empty() {
        let u = app.cfg.url_publique.trim_end_matches('/');
        let (schema, reste) = u.split_once("://").unwrap_or(("http", u));
        format!("{}://{}", schema, reste.split('/').next().unwrap_or(""))
    } else {
        let hote = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("localhost");
        format!("http://{}", hote)
    };
    let hote = origine.split("://").nth(1).unwrap_or("").to_string();
    let rp = if hote.starts_with('[') { hote } else { hote.split(':').next().unwrap_or("").to_string() };
    (origine, rp)
}

fn erreur(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "erreur": msg }))).into_response()
}

#[derive(Deserialize)]
struct OptionsParams {
    #[serde(default)]
    mode: String,
}

async fn passkey_options(
    State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Query(q): Query<OptionsParams>,
) -> Response {
    let Some(id) = authentifier(&app, &headers, addr).await else { return erreur(StatusCode::UNAUTHORIZED, "Connectez-vous d'abord.") };
    let (origine, rp) = origine_site(&app, &headers);
    if rp.parse::<std::net::IpAddr>().is_ok() || rp.starts_with('[') {
        return erreur(StatusCode::BAD_REQUEST, "Les clés d'accès ne marchent pas avec une adresse IP : ouvrez le jeu par http://localhost:8095 (ou un nom de domaine).");
    }
    let defi = app.admin.defi_webauthn(id.user_id);
    let cles: Vec<Value> = app.admin.cles.lock().unwrap().iter().map(|c| json!({ "id": c.id, "nom": c.nom, "cree": c.cree, "alg": c.alg })).collect();
    if q.mode == "enregistrer" && id.privilege > app.cfg.admin_privilege_max {
        return erreur(StatusCode::FORBIDDEN, "Déverrouillez d'abord l'administration pour ajouter une clé d'accès.");
    }
    Json(json!({ "defi": defi, "rp": rp, "origine": origine, "user": id.user_id.to_string(), "nom": id.nom, "cles": cles })).into_response()
}

#[derive(Deserialize)]
struct PasskeyEnregistrement {
    id: String,
    client: String,
    spki: String,
    alg: i64,
    #[serde(default)]
    nom: String,
}

async fn passkey_enregistrer(
    State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(p): Json<PasskeyEnregistrement>,
) -> Response {
    let Some(id) = authentifier(&app, &headers, addr).await else { return erreur(StatusCode::UNAUTHORIZED, "Connectez-vous d'abord.") };
    if id.privilege > app.cfg.admin_privilege_max {
        return erreur(StatusCode::FORBIDDEN, "Déverrouillez d'abord l'administration.");
    }
    let (origine, _) = origine_site(&app, &headers);
    let res = (|| -> Result<(), String> {
        let client = passkey::b64url(&p.client)?;
        let defi = passkey::verifier_client(&client, "webauthn.create", &origine)?;
        app.admin.consommer_defi(&defi, id.user_id)?;
        if ![-7, -8, -257].contains(&p.alg) {
            return Err("Algorithme de clé non pris en charge.".into());
        }
        passkey::b64url(&p.spki)?;
        let nom: String = p.nom.chars().filter(|c| !c.is_control()).take(40).collect();
        let mut cles = app.admin.cles.lock().unwrap();
        cles.retain(|c| c.id != p.id);
        cles.push(passkey::CleAcces {
            id: p.id.clone(),
            alg: p.alg,
            spki: p.spki.clone(),
            nom: if nom.trim().is_empty() { "Clé d'accès".into() } else { nom },
            cree: chrono::Utc::now().timestamp(),
        });
        app.admin.sauver_cles(&cles);
        Ok(())
    })();
    match res {
        Ok(()) => {
            println!("[admin] cle d'acces ajoutee par {} ({})", id.nom, id.user_id);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => erreur(StatusCode::BAD_REQUEST, &e),
    }
}

#[derive(Deserialize)]
struct PasskeyPreuve {
    id: String,
    client: String,
    auth: String,
    sig: String,
}

async fn passkey_prouver(
    State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(p): Json<PasskeyPreuve>,
) -> Response {
    let Some(id) = authentifier(&app, &headers, addr).await else { return erreur(StatusCode::UNAUTHORIZED, "Connectez-vous d'abord.") };
    let (origine, rp) = origine_site(&app, &headers);
    let res = (|| -> Result<String, String> {
        let client = passkey::b64url(&p.client)?;
        let defi = passkey::verifier_client(&client, "webauthn.get", &origine)?;
        app.admin.consommer_defi(&defi, id.user_id)?;
        let cle = app
            .admin
            .cles
            .lock()
            .unwrap()
            .iter()
            .find(|c| c.id == p.id)
            .cloned()
            .ok_or("Cette clé d'accès n'est pas enregistrée sur ce serveur.")?;
        passkey::verifier_assertion(&cle, &rp, &passkey::b64url(&p.auth)?, &client, &passkey::b64url(&p.sig)?)?;
        Ok(app.admin.ouvrir(id.user_id))
    })();
    match res {
        Ok(jeton) => {
            println!("[admin] administration deverrouillee par cle d'acces : {} ({})", id.nom, id.user_id);
            let mut r = Json(json!({ "ok": true })).into_response();
            r.headers_mut().append(
                header::SET_COOKIE,
                format!("wf_admin={}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}", jeton, admin::DUREE).parse().unwrap(),
            );
            r
        }
        Err(e) => {
            println!("[admin] cle d'acces refusee pour {} ({}) : {}", id.nom, id.user_id, e);
            erreur(StatusCode::FORBIDDEN, &e)
        }
    }
}

#[derive(Deserialize)]
struct CodeRecuperation {
    code: String,
}

/// Code de recuperation (data/admin_code.txt) : ouvre l'administration sans
/// fichier de cle, par exemple pour enregistrer une premiere cle d'acces.
async fn admin_code(
    State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(p): Json<CodeRecuperation>,
) -> Response {
    let Some(id) = authentifier(&app, &headers, addr).await else { return erreur(StatusCode::UNAUTHORIZED, "Connectez-vous d'abord.") };
    if id.compte.as_deref().map(|c| c.starts_with("invite:")).unwrap_or(false) {
        return erreur(StatusCode::FORBIDDEN, "Connectez-vous avec un compte VEX : un invité ne peut pas administrer le jeu.");
    }
    match app.admin.utiliser_code(&p.code, id.user_id) {
        Ok(jeton) => {
            println!("[admin] administration deverrouillee par code de recuperation : {} ({})", id.nom, id.user_id);
            let mut r = Json(json!({ "ok": true })).into_response();
            r.headers_mut().append(
                header::SET_COOKIE,
                format!("wf_admin={}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}", jeton, admin::DUREE).parse().unwrap(),
            );
            r
        }
        Err(e) => {
            println!("[admin] code de recuperation refuse pour {} ({})", id.nom, id.user_id);
            erreur(StatusCode::FORBIDDEN, &e)
        }
    }
}

#[derive(Deserialize)]
struct PasskeySuppression {
    id: String,
}

async fn passkey_supprimer(
    State(app): State<Partage>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(p): Json<PasskeySuppression>,
) -> Response {
    let Some(id) = authentifier(&app, &headers, addr).await else { return erreur(StatusCode::UNAUTHORIZED, "Connectez-vous d'abord.") };
    if id.privilege > app.cfg.admin_privilege_max {
        return erreur(StatusCode::FORBIDDEN, "Déverrouillez d'abord l'administration.");
    }
    let mut cles = app.admin.cles.lock().unwrap();
    cles.retain(|c| c.id != p.id);
    app.admin.sauver_cles(&cles);
    Json(json!({ "ok": true })).into_response()
}

async fn admin_sortir(State(app): State<Partage>, headers: HeaderMap) -> Response {
    app.admin.fermer(&cookie(&headers, "wf_admin"));
    let mut r = Redirect::to(&chemin(&app, "/jeu")).into_response();
    r.headers_mut().append(header::SET_COOKIE, "wf_admin=; Path=/; Max-Age=0".parse().unwrap());
    r
}

async fn api_statut(State(app): State<Partage>) -> Json<Value> {
    let (pays, blocs, guerres) = {
        let m = app.monde.lock().unwrap();
        (
            m.pays.values().filter(|p| !p.elimine).count(),
            m.blocs.len(),
            m.relations.values().filter(|r| r.etat == monde::Etat::Guerre).count(),
        )
    };
    let en_ligne = app.clients.lock().unwrap().len();
    Json(json!({ "pays": pays, "blocs": blocs, "guerres": guerres, "en_ligne": en_ligne }))
}

// ══════════════════════════════════════════════════════════════════
// WebSocket
// ══════════════════════════════════════════════════════════════════
async fn ws(
    ws: WebSocketUpgrade,
    State(app): State<Partage>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    match authentifier(&app, &headers, addr).await {
        Some(id) => ws.on_upgrade(move |s| client(app, s, id)),
        None => (StatusCode::UNAUTHORIZED, "Session VEX invalide ou expiree").into_response(),
    }
}

async fn client(app: Partage, socket: WebSocket, id: Identite) {
    let (mut envoi, mut reception) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let cid = app.prochain_client.fetch_add(1, Ordering::Relaxed);
    let admin = id.privilege <= app.cfg.admin_privilege_max;

    {
        let m = app.monde.lock().unwrap();
        let _ = tx.send(vue::init(&m, &id.nom, admin, app.cfg.vitesse, &app.cfg.vex_url));
        let bl = jeu::bilans(&m);
        let vis = vue::visions(&m, &bl);
        let publics = vue::publics(&m, &bl);
        let mut suivi = vue::Suivi::default();
        let pid = jeu::pays_du_joueur(&m, id.user_id);
        let ctx = vue::Contexte { m: &m, bl: &bl, vis: &vis, publics: Some(&publics) };
        let _ = tx.send(vue::etat(&ctx, pid, &mut suivi));
        app.clients.lock().unwrap().insert(cid, Client { user_id: id.user_id, tx: tx.clone(), suivi });
    }

    let ecrivain = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if envoi.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = reception.next().await {
        match msg {
            Message::Text(t) => {
                if t.len() > 8192 {
                    continue;
                }
                let Ok(cmd) = serde_json::from_str::<Value>(&t) else { continue };
                traiter(&app, cid, &id, admin, &cmd, &tx);
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    app.clients.lock().unwrap().remove(&cid);
    ecrivain.abort();
}

fn traiter(app: &Partage, cid: u64, id: &Identite, admin: bool, cmd: &Value, tx: &mpsc::UnboundedSender<String>) {
    let req = cmd.get("req").cloned().unwrap_or(Value::Null);
    if cmd.get("action").and_then(|a| a.as_str()) == Some("ping") {
        let _ = tx.send(json!({"t": "pong", "req": req}).to_string());
        return;
    }
    let mut m = app.monde.lock().unwrap();
    let joueur = jeu::Joueur { user_id: id.user_id, nom: &id.nom, admin, triche: admin };
    let res = jeu::commande(&mut m, &joueur, cmd, &app.regles);
    let (ok, msg) = match res {
        Ok(s) => (true, s),
        Err(e) => (false, e),
    };
    let _ = tx.send(json!({"t": "reponse", "req": req, "ok": ok, "msg": msg}).to_string());

    // Vue a jour immediatement, sans attendre le prochain tick.
    let bl = jeu::bilans(&m);
    let vis = vue::visions(&m, &bl);
    let publics = vue::publics(&m, &bl);
    let pid = jeu::pays_du_joueur(&m, id.user_id);
    let mut clients = app.clients.lock().unwrap();
    if let Some(c) = clients.get_mut(&cid) {
        let ctx = vue::Contexte { m: &m, bl: &bl, vis: &vis, publics: Some(&publics) };
        let _ = c.tx.send(vue::etat(&ctx, pid, &mut c.suivi));
    }
}
