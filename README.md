# WFront

A multiplayer strategy and war game in the browser: you lead a country, grow it, manage your alliances… then go to war.

**Rust** server (Axum + Tokio, real-time WebSocket), 3D map in **Three.js**, sign-in with **VEX accounts**. Same look as VEX: colors, icons, navigation bar, cards, and the user's light/dark theme.

## Game content

| | |
|---|---|
| **Map** | The **real world map** in hexagons, with real proportions (Equal Earth projection: true surface areas; latitudes 56° S to 83° N, no Antarctica). Real mountain ranges, deserts, forests and tundra (game approximation). Optionally a randomly generated world (`"carte": "aleatoire"`). Oceans, coasts, plains, forests, hills, mountains, deserts, tundra, meteorite craters. 3D relief, fog of war, three modes (political, terrain, resources). |
| **Resources** | Credits, food, metal, oil, uranium, rare earths, plus electricity, population, influence and research. Each region has its own deposits. |
| **Troops (OpenFront style)** | A troop pool that refills on its own (maximum depends on territory, cities, the capital, barracks). **Right-click** a tile: send an adjustable share of your troops, which advance tile by tile toward it (neutral land: the country expands; enemy at war: invasion against its terrain, forts and troops; distant coast: landing from a shipyard). **Left-click**: build. |
| **Ores and crafting** | 4 ores (common, rare, radioactive, legendary), extracted by quarries and mines. The refinery turns them into metal, rare earths, uranium, or any of the **118 elements** of the periodic table (legendary ones decay quickly). The factory assembles **105 products** across 8 tiers, from steel to the **black hole**. |
| **Buildings** | 29 buildings (city, farms, mines, wells, thermal/solar/nuclear plants, industry, labs, warehouses, bank, hospital, barracks, armor factory, air base, shipyard, silo, surface-to-air battery, fortifications, radar…), 5 levels (8 with "Great works"). |
| **Technologies** | 48 technologies in 4 interlocking branches (military, economy, diplomacy, industry). Research queue. |
| **Units** | 17 units: infantry, special forces (stealth), armored vehicles, tanks, artillery, mobile AA, fighters, helicopters, bombers, drones, frigates, destroyers, submarines (stealth), aircraft carriers, cruise, ballistic and nuclear missiles (yield depends on the fissile material and explosives loaded; casualties depend on population density), antimatter and black hole bombs. |
| **Real-time war** | Pathfinding movement, assaults, terrain and fortification bonuses, ranged bombardment, air raids with interception (batteries, AA, enemy fighters), interceptable missiles, nuclear strikes (irradiated zone, global alert), capital capture and government relocation, amphibious operations. |
| **Diplomacy** | War, peace, non-aggression pacts, resource aid, espionage (sabotage, tech theft, destabilization), protection for new players. |
| **Blocs** | NATO-style alliances: automatic collective defense, shared vision and radars, common treasury, private chat channel, applications and invitations. |
| **World market** | Prices shared by everyone, rising on purchases and falling on sales. |
| **Rankings** | Overall, military, economy, territory, technology, population, diplomacy, victories, blocs. |
| **Social** | Journal (country events and world news), world and bloc messaging, notifications. |

Computer-controlled nations can fill the game (`"bots"` in `config.json`, 0 for none).

## Real countries (world map)

On the world map, the **real countries** are playable: the independent states plus Taiwan, Palestine, Kosovo and Western Sahara, as long as they cover at least **10 hexes** (`MIN_CASES` in `monde.rs`; about 130 countries at 500 wide). Smaller countries (micro-states, small islands, and at this size also Belgium, the Netherlands, Switzerland…) are not playable: their land is free land that neighbours can annex. Overseas territories belong to the country that governs them (French Guiana, Réunion, New Caledonia → France; Greenland → Denmark; Puerto Rico → United States; Falklands → United Kingdom…).

- When joining, a player **chooses a country**: they get its whole territory (overseas included) and their capital is placed at the real capital. A country already led by another player cannot be taken.
- **No computer nations**: the world is played between players only, as a persistent server over weeks.
- If a country is wiped out, its player can take another free country (or the free part of a country).
- On the map, thin lines show the real borders; hovering a hex shows its real country and whether it is free.
- **Getting started**: after choosing a country, a step-by-step tutorial shows the interface (resources, building, troops, menu). An **objectives** card on the map states the goal (become the world's first power in the overall ranking) and the next step to take (build, research, expand, recruit, find an ally, reach the top 10). The tutorial can be replayed from the Guide.

Country borders and names come from Natural Earth and the `world-countries` package; capitals are listed in `outils/carte-monde/capitales.js`.

## Run locally (without VEX)

```bash
cargo run --release
```

Then open http://127.0.0.1:8095. In **dev mode** (`"auth": "dev"`), any nickname opens a session; after unlocking administration (see below), `devTout()` in the browser console gives all technologies, resources and a bit of every element.

## Administration: private key

Administration (world announcement, nation removal, `devTout`) only appears and works for the holder of the **admin key**:

1. Create an Ed25519 key pair: `openssl genpkey -algorithm ed25519 -out "wfront admin.pem"`.
2. Put the public key (32 bytes in base64: `openssl pkey -in "wfront admin.pem" -pubout -outform DER | tail -c 32 | base64`) in `admin_cle_publique` in `config.json`.
3. Open `/admin` and choose the `.pem` file: the browser signs a server challenge, and the key never leaves the computer. Unlocking lasts 12 h and only applies to the account that obtained it.

`cargo run -- --apercu` prints the map as text, handy for checking a map size or choosing a `graine` (seed).

The world map comes from `src/monde_reel.bin`, built from Natural Earth (public domain) by `outils/carte-monde`: `cd outils/carte-monde && npm install && node generer.js` (add `--apercu monde.ppm` for a picture). Mountain ranges, deserts and forests are listed at the top of `generer.js`.

## Sign-in: "Sign in with VEX" (`reseau` mode, the default)

A player signs in with their account from **any node of the VEX network**:

1. On the home page, **Sign in with VEX** sends them straight to the default node (`noeud_par_defaut`). On `/connexion`, they can enter another node.
2. WFront fetches the node's Ed25519 public key (`/p2p/ping`) and checks that it appears in the network directory (`annuaire_url`).
3. The player is sent to `/p2p/sso` on their node. They log in there if needed, then click **Authorize**.
4. The node signs their identity (`user_id@node_id`, name, theme) with its P2P key and sends them back to `/auth/retour`.
5. WFront verifies the signature, then opens its own session (cookie `wf_session`, 30 days).

The password never leaves the node. A node can only sign for its own accounts.

**On the VEX side:** every node must run the VEX version that contains `src/p2p/sso.rs` (route `/p2p/sso`) and the `?suite=` parameter of `/login`. An older node returns an error at step 3.

In this mode, WFront can run anywhere, even on a different domain from VEX. `url_publique` must be the address players see (e.g. `https://jeu.exemple.org`), because the node sends the player back there. Game administration goes through the admin key (see above).

## Option: same server as VEX (`vex` mode, a single node)

WFront is a **separate process** with its own port. It never modifies the VEX database: it only reads `loginc`, `login` and `pref` to recognize the session.

### Why behind the same Apache as VEX

VEX records the session IP **as seen behind Apache** (`127.0.0.1`), and its `connexion_cookie` cookie is only sent to the same domain. WFront must therefore be served by the same Apache, under a path (e.g. `https://vex.hopto.org/wfront/`): the cookie arrives, and the IP WFront sees (`127.0.0.1`) is the same as the one VEX recorded.

### 1. Build and configure

```bash
cd ~/wfront
cargo build --release
cp config.example.json config.json
```

`config.json`:

```json
{
  "adresse": "127.0.0.1",
  "port": 8095,
  "vex_url": "",
  "prefixe": "/wfront",
  "auth": "vex",
  "vex_db_fichier": "../vex-rs/db.json",
  "proxy_de_confiance": false
}
```

- `vex_url` empty: links to VEX stay on the same domain (`/login/dashboard`, `/login`…).
- `vex_db_fichier`: VEX's `db.json`, relative to the WFront folder (same MySQL credentials).
- `adresse: 127.0.0.1`: only Apache can reach the game.
- `proxy_de_confiance` must stay `false`, like VEX which compares the proxy's raw IP.

### 2. Apache

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel
```

In VEX's VirtualHost, **before** the rules that forward to VEX:

```apache
RedirectMatch ^/wfront$ /wfront/
ProxyPass        /wfront/ws  ws://127.0.0.1:8095/ws
ProxyPass        /wfront/    http://127.0.0.1:8095/
ProxyPassReverse /wfront/    http://127.0.0.1:8095/
```

```bash
sudo apachectl configtest && sudo systemctl reload apache2
```

### 3. Start / update

Same method as VEX: wait until the old process has really stopped before copying the binary.

```bash
cargo build --release
PID=$(pgrep -f './wfront$'); [ -n "$PID" ] && kill $PID && while kill -0 $PID 2>/dev/null; do sleep 0.5; done
cp -f target/release/wfront ./wfront
setsid nohup ./wfront >> wfront.out 2>&1 < /dev/null & disown
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8095/
```

The world is saved every 30 s, and also on shutdown (`kill` or Ctrl+C). Only a `kill -9` can lose the last 30 seconds.

### VEX session

The VEX session lasts one hour (`datecra` in `loginc`). A game already open keeps going, but reconnecting after expiry shows "VEX session expired" with a link to the VEX login.

## Settings (`config.json`)

| Key | Default | Purpose |
|---|---|---|
| `adresse`, `port` | `0.0.0.0`, `8095` | Server listen address |
| `vex_url` | `http://127.0.0.1:8080` | VEX address for links and sign-in (empty = same domain) |
| `prefixe` | `""` | Path exposed by the proxy, for redirects |
| `auth` | `reseau` | `reseau` = "Sign in with VEX" (any node), `vex` = sessions of a single node read from its database, `dev` = free nickname (local tests) |
| `url_publique` | `""` | Public address of WFront (reseau mode), otherwise inferred from the Host header |
| `annuaire_url` | `https://vex.hopto.org/neut/annuaire` | Only nodes in this directory are accepted (empty = any VEX server) |
| `noeud_par_defaut` | `vex.hopto.org` | Pre-filled on the sign-in page |
| `admin_cle_publique` | `""` | Public key of the admin key (see above) |
| `vex_db_fichier` / `vex_db` | — | VEX MySQL access (path to `db.json`, or inline credentials) |
| `session_duree_s` | `3600` | Same duration as VEX |
| `verifier_ip`, `verifier_navigateur` | `true` | Same checks as VEX's `verifier_session` |
| `carte` | `monde` | `monde` = real world map where each player takes a real country (no computer nations), `aleatoire` = invented continents with bots. Used for a new world (first launch, or admin "New map") |
| `largeur_monde` | `500` | Width of the world map (500 × 262 hexes); the height follows real proportions |
| `carte_largeur`, `carte_hauteur`, `graine` | `384`, `240`, `0` | Size of the random map (`aleatoire`). `graine` changes deposits, and the whole map with `aleatoire` (0: random) |
| `vitesse` | `1.0` | Speeds up the whole game (tests) |
| `protection_heures` | `2` | How long a new country cannot be attacked |
| `sauvegarde`, `intervalle_sauvegarde_s` | `data/monde.json`, `30` | World file and save frequency |
| `bots` | `6` | Computer-controlled nations (0 = none, 16 max). They follow the same rules as players: they grow, annex, research, arm themselves, answer peace proposals and sometimes attack a weaker neighbor (never during its protection). |

To start from a fresh world: stop the server, delete `data/monde.json`, restart.

## Code layout

```
src/
  main.rs    HTTP/WebSocket server, configuration, VEX session, game loop, saving
  defs.rs    all the content: resources, terrains, buildings, units, technologies
  monde.rs   world state, hexagonal geometry, map generation
  jeu.rs     rules: economy, construction, research, movement, combat,
             raids, missiles, diplomacy, blocs, market, espionage
  front.rs   OpenFront-style troops and offensives (right-click)
  fabrication.rs  ores, 118 elements, refinery, 105 factory recipes
  admin.rs   admin key (Ed25519 signed challenge)
  bots.rs    computer-controlled nations
  vue.rs     what each player sees (fog of war, hidden data)
static/
  accueil.html, jeu.html, dev.html
  css/theme.css        exact copy of the VEX theme
  css/wfront.css   game styles (theme.css tokens only)
  js/jeu.js            client: connection, interface, orders
  js/carte.js          Three.js 3D rendering
  js/panneaux.js       panels (country, construction, armies, research…)
  img/solid/           VEX icons
  vendor/              Three.js (served locally, no CDN)
```

The server validates every action: the client only sends intentions (`construire`, `deplacer`, `guerre`…).
