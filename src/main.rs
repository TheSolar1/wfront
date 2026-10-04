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

mod bots;
mod defs;
mod jeu;
mod monde;
mod reseau;
mod vue;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::get,
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
    /// Comptes reseau administrateurs du jeu (« user_id@node_id »).
    admins: Vec<String>,
    /// Chemin du db.json de VEX (memes identifiants MySQL que VEX).
    vex_db_fichier: String,
    vex_db: Option<DbConf>,
    session_duree_s: i64,
    verifier_ip: bool,
    verifier_navigateur: bool,
    /// Si WorldFront est derriere un reverse proxy : lire X-Forwarded-For.
    proxy_de_confiance: bool,
    /// Privilege VEX maximal pour les outils d'administration du jeu (1 = super admin).
    admin_privilege_max: i64,
    carte_largeur: usize,
    carte_hauteur: usize,
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
            admins: Vec::new(),
            vex_db_fichier: String::new(),
            vex_db: None,
            session_duree_s: 3600,
            verifier_ip: true,
            verifier_navigateur: true,
            proxy_de_confiance: false,
            admin_privilege_max: 3,
            carte_largeur: 84,
            carte_hauteur: 52,
            graine: 20260925,
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
    sombre: bool,
    /// Nœud VEX de l'utilisateur (mode reseau) : cible des liens VEX.
    noeud: Option<String>,
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
    println!("[monde] generation d'une carte {}x{} (graine {}).", cfg.carte_largeur, cfg.carte_hauteur, cfg.graine);
    monde::Monde::generer(cfg.carte_largeur.clamp(30, 200), cfg.carte_hauteur.clamp(20, 140), cfg.graine)
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
    });

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
        .route("/deconnexion", get(deconnexion))
        .route("/api/statut", get(api_statut))
        .route("/ws", get(ws))
        .nest_service("/static", ServeDir::new(racine.join("static")))
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
    let m = monde::Monde::generer(cfg.carte_largeur, cfg.carte_hauteur, cfg.graine);
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
    if app.cfg.bots > 0 {
        bots::jouer(&mut m, &app.regles, &bl, dt);
    }
    bots::assurer(&mut m, app.cfg.bots, &app.regles, dt);
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
        sombre: teme.flatten().unwrap_or(0) == 1,
        noeud: None,
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

async fn authentifier(app: &Partage, headers: &HeaderMap, addr: SocketAddr) -> Option<Identite> {
    if app.cfg.auth == "dev" {
        let nom = decoder_url(&cookie(headers, "wf_dev"));
        let nom: String = nom.chars().filter(|c| !c.is_control()).take(24).collect();
        if nom.trim().len() < 2 {
            return None;
        }
        let sombre = cookie(headers, "wf_theme") == "dark";
        return Some(Identite { user_id: hash_nom(&nom), nom, privilege: 1, sombre, noeud: None });
    }
    if app.cfg.auth == "reseau" {
        let s = app.reseau.session(&cookie(headers, "wf_session"))?;
        let admin = app.cfg.admins.iter().any(|a| a == &s.compte);
        return Some(Identite {
            user_id: reseau::id_compte(&s.compte),
            nom: s.nom,
            privilege: if admin { 1 } else { 10 },
            sombre: s.sombre,
            noeud: Some(s.noeud),
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
        format!("{}/login", app.cfg.vex_url.trim_end_matches('/'))
    }
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
        .replace("__NOM__", &echapper(id.map(|i| i.nom.as_str()).unwrap_or("")))
        .replace("__CONNECTE__", if id.is_some() { "1" } else { "0" })
        .replace("__MODE__", &echapper(&app.cfg.auth))
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
        None => Redirect::to(&url_connexion(&app)).into_response(),
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
    match app.reseau.retour(&q, &retour) {
        Ok((jeton, s)) => {
            println!("[auth] connexion de {} ({}) via {}", s.nom, s.compte, s.noeud);
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

async fn deconnexion(State(app): State<Partage>, headers: HeaderMap) -> Response {
    app.reseau.fermer(&cookie(&headers, "wf_session"));
    let mut r = Redirect::to(&chemin(&app, "/")).into_response();
    r.headers_mut().append(header::SET_COOKIE, "wf_session=; Path=/; Max-Age=0".parse().unwrap());
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
    let joueur = jeu::Joueur { user_id: id.user_id, nom: &id.nom, admin, triche: app.cfg.auth == "dev" };
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
