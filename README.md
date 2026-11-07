# WFront

A multiplayer strategy and war game in the browser: you lead a country, grow it, manage your alliances… then go to war.

**Rust** server (Axum + Tokio, real-time WebSocket), 3D map in **Three.js**. The game is **standalone**: players create a **WFront account** (nickname + password) or play as a guest. No external service or database server is needed: everything is stored in JSON files in the `data/` folder.

## Game content

| | |
|---|---|
| **Map** | Randomly generated hexagonal world (128 × 80 by default): continent size, sea level, coasts and climate change with every world. Oceans, coasts, plains, forests, hills, mountains, deserts, tundra, meteorite craters. 3D relief, fog of war, three modes (political, terrain, resources). |
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

## Run locally

```bash
cp config.example.json config.json
cargo run --release
```

Then open http://127.0.0.1:8095: create an account (or play without one) and you're in. To test quickly, use **Play without an account**. As an administrator (see below), `devTout()` in the browser console gives all technologies, resources and a bit of every element.

## Administration: private key

Administration (world announcement, nation removal, `devTout`) only appears and works for the holder of the **admin key**:

1. Create an Ed25519 key pair: `openssl genpkey -algorithm ed25519 -out "wfront admin.pem"`.
2. Put the public key (32 bytes in base64: `openssl pkey -in "wfront admin.pem" -pubout -outform DER | tail -c 32 | base64`) in `admin_cle_publique` in `config.json`.
3. Open `/admin` and choose the `.pem` file: the browser signs a server challenge, and the key never leaves the computer. Unlocking lasts 12 h and only applies to the account that obtained it.

`cargo run -- --apercu` prints the map as text, handy for choosing a `graine` (seed).

## Player accounts

WFront manages its players itself:

- **Create an account** (`/connexion#inscription`): a unique nickname (3 to 20 characters: letters, digits, `_`, `-`, `.`; not case-sensitive) and a password (8 characters minimum). No e-mail is asked.
- **Sign in** (`/connexion`): nickname + password. After 10 failed attempts, an IP address is blocked for 15 minutes; at most 5 accounts can be created per IP and per hour.
- **Play without an account** (`"invites": true`): a nickname is enough, the game is tied to the browser. When a guest then creates an account (or signs in), **their nation follows them**.
- **My account** (`/compte`): light/dark theme (remembered on every device), password change (other devices are signed out), account deletion (the nation is deleted with it, its land becomes neutral).

Passwords are stored as **Argon2id** hashes (never in clear text). To make an account an administrator, put its nickname in `"admins"` in `config.json` (e.g. `"admins": ["clement"]`).

There is no password recovery by e-mail yet: an administrator can delete a forgotten account's entry from `data/comptes.json` (server stopped) so the player can sign up again.

## Where the data is stored

Everything lives in the **`data/` folder next to the server** (created automatically on first launch), as JSON files. No database to install:

| File | Content |
|---|---|
| `data/monde.json` | The world: map, nations, armies, diplomacy… (saved every 30 s and on shutdown) |
| `data/comptes.json` | Player accounts: nickname, Argon2id password hash, theme, creation date |
| `data/sessions.json` | Open sessions (30 days, `wf_session` cookie) |
| `data/admin_*.json`, `data/admin_code.txt` | Administration: unlock tokens, passkeys, recovery code |

**Back up the whole `data/` folder regularly** (for example `tar czf wfront-data-$(date +%F).tar.gz data/` in a daily cron job, copied to another machine). `deploy-sur.sh` already copies `data/monde.json` before each deployment.

This is enough for a few hundred players on a Raspberry Pi. If the game grows a lot (thousands of accounts, several servers), the accounts can later be moved to a SQLite or PostgreSQL database without changing the rest of the game.

## Behind Apache (optional)

To serve WFront under a path of an existing site (e.g. `https://exemple.org/wfront/`), set `"prefixe": "/wfront"` and `"adresse": "127.0.0.1"` in `config.json`, then:


```bash
sudo a2enmod proxy proxy_http proxy_wstunnel
```

In the site's VirtualHost:

```apache
RedirectMatch ^/wfront$ /wfront/
ProxyPass        /wfront/ws  ws://127.0.0.1:8095/ws
ProxyPass        /wfront/    http://127.0.0.1:8095/
ProxyPassReverse /wfront/    http://127.0.0.1:8095/
```

```bash
sudo apachectl configtest && sudo systemctl reload apache2
```

## Start / update by hand

Wait until the old process has really stopped before copying the binary (or use `./deploy-sur.sh`, which does it all with a backup and automatic rollback).

```bash
cargo build --release
PID=$(pgrep -f './wfront$'); [ -n "$PID" ] && kill $PID && while kill -0 $PID 2>/dev/null; do sleep 0.5; done
cp -f target/release/wfront ./wfront
setsid nohup ./wfront >> wfront.out 2>&1 < /dev/null & disown
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8095/
```

The world is saved every 30 s, and also on shutdown (`kill` or Ctrl+C). Only a `kill -9` can lose the last 30 seconds.

## Settings (`config.json`)

| Key | Default | Purpose |
|---|---|---|
| `adresse`, `port` | `0.0.0.0`, `8095` | Server listen address |
| `prefixe` | `""` | Path exposed by the proxy, for redirects |
| `proxy_de_confiance` | `false` | Behind a reverse proxy: read the client IP from `X-Forwarded-For` |
| `invites` | `true` | Allow playing without an account |
| `admins` | `[]` | Nicknames of administrator accounts |
| `url_publique` | `""` | Public address of WFront (e.g. `https://jeu.exemple.org`), otherwise inferred from the Host header |
| `admin_cle_publique` | `""` | Public key of the admin key (see above) |
| `carte_largeur`, `carte_hauteur`, `graine` | `128`, `80`, `0` | World generation (first launch only). `graine` at 0: random map |
| `vitesse` | `1.0` | Speeds up the whole game (tests) |
| `protection_heures` | `2` | How long a new country cannot be attacked |
| `sauvegarde`, `intervalle_sauvegarde_s` | `data/monde.json`, `30` | World file and save frequency |
| `bots` | `6` | Computer-controlled nations (0 = none, 16 max). They follow the same rules as players: they grow, annex, research, arm themselves, answer peace proposals and sometimes attack a weaker neighbor (never during its protection). |

To start from a fresh world: stop the server, delete `data/monde.json`, restart.

## Code layout

```
src/
  main.rs    HTTP/WebSocket server, configuration, sign-in, game loop, saving
  comptes.rs WFront accounts (nickname + Argon2id password)
  sessions.rs player sessions (wf_session cookie)
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
  accueil.html, jeu.html, entrer.html (sign in / sign up), compte.html (my account)
  admin.html (administration)
  css/theme.css        theme tokens (light / dark)
  css/wfront.css   game styles (theme.css tokens only)
  js/jeu.js            client: connection, interface, orders
  js/carte.js          Three.js 3D rendering
  js/panneaux.js       panels (country, construction, armies, research…)
  img/solid/           icons
  vendor/              Three.js (served locally, no CDN)
```

The server validates every action: the client only sends intentions (`construire`, `deplacer`, `guerre`…).
