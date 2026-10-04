# WorldFront

Jeu de stratégie et de guerre multijoueur dans le navigateur : on dirige un pays, on le fait grandir, on gère ses alliances… puis la guerre.

Serveur en **Rust** (Axum + Tokio, WebSocket temps réel), carte 3D en **Three.js**, connexion avec les **comptes VEX**. Même charte que VEX : couleurs, icônes, barre de navigation, cartes, thème clair/sombre de l'utilisateur.

## Contenu du jeu

| | |
|---|---|
| **Carte** | Monde hexagonal généré (84 × 52 par défaut) : océans, côtes, plaines, forêts, collines, montagnes, déserts, toundra. Relief 3D, brouillard de guerre, trois modes (politique, terrain, ressources). |
| **Ressources** | Crédits, nourriture, métal, pétrole, uranium, terres rares, plus électricité, population, influence et recherche. Chaque région a ses gisements. |
| **Territoire** | La capacité territoriale dépend des centres administratifs et des villes construits. On annexe les provinces neutres voisines, ou on conquiert celles de l'ennemi. |
| **Bâtiments** | 25 bâtiments (ville, fermes, mines, puits, centrales thermique/solaire/nucléaire, industrie, laboratoires, entrepôts, banque, hôpital, caserne, usine de blindés, base aérienne, chantier naval, silo, batterie sol-air, fortifications, radar…), 5 niveaux (8 avec « Grands travaux »). |
| **Technologies** | 48 technologies en 4 branches (militaire, économie, diplomatie, industrie) qui se croisent. File de recherche. |
| **Unités** | 17 unités : infanterie, forces spéciales (furtives), blindés, chars, artillerie, DCA mobile, chasseurs, hélicoptères, bombardiers, drones, frégates, destroyers, sous-marins (furtifs), porte-avions, missiles de croisière, balistiques, nucléaires. |
| **Guerre en temps réel** | Déplacements avec recherche de chemin, assauts, bonus de relief et de fortifications, bombardement à distance, raids aériens avec interception (batteries, DCA, chasse ennemie), missiles interceptables, frappe nucléaire (zone irradiée, alerte mondiale), capture de capitale et repli du gouvernement, opérations amphibies. |
| **Diplomatie** | Guerre, paix, pactes de non-agression, aide en ressources, espionnage (sabotage, vol technologique, déstabilisation), protection des nouveaux joueurs. |
| **Blocs** | Alliances façon OTAN : défense collective automatique, vision et radars partagés, trésor commun, canal de discussion privé, candidatures et invitations. |
| **Marché mondial** | Prix communs à tous, qui montent à l'achat et baissent à la vente. |
| **Classements** | Général, militaire, économie, territoire, technologie, population, diplomatie, victoires, blocs. |
| **Social** | Journal (événements du pays et actualité mondiale), messagerie monde et bloc, notifications. |

Aucune IA dans le jeu : pas de pays contrôlés par l'ordinateur ni d'assistant, uniquement des joueurs.

## Lancer en local (sans VEX)

```bash
cargo run --release
```

Puis ouvrir http://127.0.0.1:8095. Le `config.json` fourni est en **mode dev** : n'importe quel pseudo ouvre une session. Dans la console du navigateur, `devTout()` donne toutes les technologies et des ressources pour tester la fin de partie. Cette commande est refusée par le serveur hors mode dev.

`cargo run -- --apercu` affiche la carte en texte, pratique pour choisir une `graine`.

## Connexion : « Se connecter avec VEX » (mode `reseau`, par défaut)

Un joueur se connecte avec son compte de **n'importe quel nœud du réseau VEX** :

1. Sur `/connexion`, il indique l'adresse de son nœud (ex. `vex.hopto.org`).
2. WorldFront récupère la clé publique Ed25519 du nœud (`/p2p/ping`) et vérifie qu'il figure dans l'annuaire du réseau (`annuaire_url`).
3. Le joueur est envoyé sur `/p2p/sso` de son nœud. Il s'y connecte si besoin, puis clique sur **Autoriser**.
4. Le nœud signe son identité (`user_id@node_id`, nom, thème) avec sa clé P2P et le renvoie sur `/auth/retour`.
5. WorldFront vérifie la signature, puis ouvre sa propre session (cookie `wf_session`, 30 jours).

Le mot de passe ne quitte jamais le nœud. Un nœud ne peut signer que pour ses propres comptes.

**Côté VEX :** chaque nœud doit avoir la version de VEX qui contient `src/p2p/sso.rs` (route `/p2p/sso`) et le paramètre `?suite=` de `/login`. Un nœud plus ancien renvoie une erreur à l'étape 3.

Dans ce mode, WorldFront peut tourner n'importe où, même sur un autre domaine que VEX. Il faut que `url_publique` soit l'adresse que voient les joueurs (ex. `https://jeu.exemple.org`), car le nœud y renvoie le joueur. Les administrateurs du jeu se déclarent dans `admins` (`"user_id@node_id"`, visible dans le journal du serveur à chaque connexion).

## Option : même serveur que VEX (mode `vex`, un seul nœud)

WorldFront est un **processus séparé** avec son propre port. Il ne modifie jamais la base VEX : il lit seulement `loginc`, `login` et `pref` pour reconnaître la session.

### Pourquoi derrière le même Apache que VEX

VEX enregistre l'IP de la session **telle que vue derrière Apache** (`127.0.0.1`), et son cookie `connexion_cookie` n'est envoyé qu'au même domaine. WorldFront doit donc être servi par le même Apache, sous un chemin (ex. `https://vex.hopto.org/worldfront/`) : le cookie arrive, et l'IP vue par WorldFront (`127.0.0.1`) est la même que celle enregistrée par VEX.

### 1. Compiler et configurer

```bash
cd ~/worldfront
cargo build --release
cp config.example.json config.json
```

`config.json` :

```json
{
  "adresse": "127.0.0.1",
  "port": 8095,
  "vex_url": "",
  "prefixe": "/worldfront",
  "auth": "vex",
  "vex_db_fichier": "../vex-rs/db.json",
  "proxy_de_confiance": false
}
```

- `vex_url` vide : les liens vers VEX restent sur le même domaine (`/login/dashboard`, `/login`…).
- `vex_db_fichier` : le `db.json` de VEX, relatif au dossier de WorldFront (mêmes identifiants MySQL).
- `adresse: 127.0.0.1` : seul Apache peut joindre le jeu.
- `proxy_de_confiance` doit rester à `false`, comme VEX qui compare l'IP brute du proxy.

### 2. Apache

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel
```

Dans le VirtualHost de VEX, **avant** les règles qui renvoient vers VEX :

```apache
RedirectMatch ^/worldfront$ /worldfront/
ProxyPass        /worldfront/ws  ws://127.0.0.1:8095/ws
ProxyPass        /worldfront/    http://127.0.0.1:8095/
ProxyPassReverse /worldfront/    http://127.0.0.1:8095/
```

```bash
sudo apachectl configtest && sudo systemctl reload apache2
```

### 3. Démarrer / mettre à jour

Même méthode que VEX : attendre que l'ancien processus soit vraiment arrêté avant de copier le binaire.

```bash
cargo build --release
PID=$(pgrep -f './worldfront$'); [ -n "$PID" ] && kill $PID && while kill -0 $PID 2>/dev/null; do sleep 0.5; done
cp -f target/release/worldfront ./worldfront
setsid nohup ./worldfront >> worldfront.out 2>&1 < /dev/null & disown
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8095/
```

Le monde est sauvegardé toutes les 30 s, et aussi à l'arrêt (`kill` ou Ctrl+C). Seul un `kill -9` peut faire perdre les 30 dernières secondes.

### Session VEX

La session VEX dure une heure (`datecra` dans `loginc`). Une partie déjà ouverte continue, mais une reconnexion après expiration affiche « Session VEX expirée » avec un lien vers la connexion VEX.

## Réglages (`config.json`)

| Clé | Défaut | Rôle |
|---|---|---|
| `adresse`, `port` | `0.0.0.0`, `8095` | Écoute du serveur |
| `vex_url` | `http://127.0.0.1:8080` | Adresse de VEX pour les liens et la connexion (vide = même domaine) |
| `prefixe` | `""` | Chemin exposé par le proxy, pour les redirections |
| `auth` | `reseau` | `reseau` = « Se connecter avec VEX » (tout nœud), `vex` = sessions d'un seul nœud lues dans sa base, `dev` = pseudo libre (tests locaux) |
| `url_publique` | `""` | Adresse publique de WorldFront (mode reseau), sinon déduite de l'en-tête Host |
| `annuaire_url` | `https://vex.hopto.org/neut/annuaire` | Seuls les nœuds de cet annuaire sont acceptés (vide = tout serveur VEX) |
| `noeud_par_defaut` | `vex.hopto.org` | Pré-rempli sur la page de connexion |
| `admins` | `[]` | Comptes `user_id@node_id` administrateurs du jeu (mode reseau) |
| `vex_db_fichier` / `vex_db` | — | Accès MySQL de VEX (chemin du `db.json`, ou identifiants en ligne) |
| `session_duree_s` | `3600` | Même durée que VEX |
| `verifier_ip`, `verifier_navigateur` | `true` | Mêmes contrôles que `verifier_session` de VEX |
| `admin_privilege_max` | `3` | Privilège VEX donnant accès au panneau Administration du jeu |
| `carte_largeur`, `carte_hauteur`, `graine` | `84`, `52`, `20260925` | Génération du monde (au premier lancement seulement) |
| `vitesse` | `1.0` | Accélère tout le jeu (tests) |
| `protection_heures` | `2` | Durée pendant laquelle un nouveau pays ne peut pas être attaqué |
| `sauvegarde`, `intervalle_sauvegarde_s` | `data/monde.json`, `30` | Fichier du monde et fréquence d'enregistrement |
| `bots` | `6` | Nations jouées par l'ordinateur (0 = aucune, 16 au maximum). Elles suivent les mêmes règles que les joueurs : elles se développent, annexent, recherchent, s'arment, répondent aux propositions de paix et attaquent parfois un voisin plus faible (jamais pendant sa protection). |

Pour repartir d'un monde neuf : arrêter le serveur, supprimer `data/monde.json`, relancer.

## Organisation du code

```
src/
  main.rs    serveur HTTP/WebSocket, configuration, session VEX, boucle de jeu, sauvegarde
  defs.rs    tout le contenu : ressources, terrains, bâtiments, unités, technologies
  monde.rs   état du monde, géométrie hexagonale, génération de la carte
  jeu.rs     règles : économie, construction, recherche, déplacements, combats,
             raids, missiles, diplomatie, blocs, marché, espionnage
  vue.rs     ce que chaque joueur voit (brouillard de guerre, données masquées)
static/
  accueil.html, jeu.html, dev.html
  css/theme.css        copie à l'identique du thème VEX
  css/worldfront.css   styles du jeu (jetons de theme.css uniquement)
  js/jeu.js            client : connexion, interface, ordres
  js/carte.js          rendu 3D Three.js
  js/panneaux.js       panneaux (pays, construction, armées, recherche…)
  img/solid/           icônes VEX
  vendor/              Three.js (servi localement, pas de CDN)
```

Le serveur valide chaque action : le client n'envoie que des intentions (`construire`, `deplacer`, `guerre`…).
