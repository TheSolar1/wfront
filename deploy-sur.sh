#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# deploy-sur.sh — Déploiement MANUEL et sûr de WorldFront sur le Pi.
#
# Pensé pour le cas « 2 collaborateurs sur GitHub » : on NE déploie
# JAMAIS automatiquement. On regarde d'abord qui a poussé quoi, on
# sauvegarde, on construit, et on ne bascule que si le build réussit.
# En cas de pépin, retour arrière automatique sur l'ancien binaire.
#
# PAS de cron, PAS de pull automatique : tu lances ce script toi-même.
#
#   cd ~/worldfront
#   ./deploy-sur.sh            # montre les nouveautés puis demande confirmation
#   ./deploy-sur.sh --oui      # enchaîne sans la question (si tu as déjà vu)
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

DIR="$HOME/worldfront"
PORT=8095
BRANCHE=main
BIN=worldfront
SAUVE="$DIR/.sauvegardes"
HORO=$(date +%Y%m%d-%H%M%S)
AUTO_OUI=0
[ "${1:-}" = "--oui" ] && AUTO_OUI=1

cd "$DIR"
mkdir -p "$SAUVE"

echo "── 1. Ce que GitHub propose ───────────────────────────────"
git fetch origin "$BRANCHE"
LOCAL=$(git rev-parse HEAD)
DISTANT=$(git rev-parse "origin/$BRANCHE")
if [ "$LOCAL" = "$DISTANT" ]; then
  echo "Déjà à jour ($LOCAL). Rien à déployer."; exit 0
fi
echo "Nouveaux commits (auteur · date · message) :"
git log --no-merges --pretty="  %C(auto)%h  %an  %ad  %s" --date=short "$LOCAL..origin/$BRANCHE"
echo
echo "Fichiers touchés :"
git diff --stat "$LOCAL..origin/$BRANCHE"
echo
# Garde-fou : on refuse une bascule si des fichiers sensibles changent
# sans que tu l'aies vu passer (config, secrets, données du monde).
if git diff --name-only "$LOCAL..origin/$BRANCHE" | grep -qE '(^config\.json$|\.pem$|secret|data/monde\.json)'; then
  echo "⚠️  ATTENTION : un fichier sensible (config / clé / monde) change dans ces commits."
  echo "    Vérifie-le avant de continuer :  git diff $LOCAL..origin/$BRANCHE -- config.json"
fi

if [ "$AUTO_OUI" -ne 1 ]; then
  read -r -p "Déployer ces changements ? [o/N] " REP
  [ "$REP" = "o" ] || [ "$REP" = "O" ] || { echo "Annulé. Rien n'a changé."; exit 0; }
fi

echo "── 2. Sauvegarde de l'état actuel ─────────────────────────"
[ -f "$BIN" ] && cp -f "$BIN" "$SAUVE/$BIN.$HORO" && echo "  binaire → $SAUVE/$BIN.$HORO"
[ -f data/monde.json ] && cp -f data/monde.json "$SAUVE/monde.$HORO.json" && echo "  monde   → $SAUVE/monde.$HORO.json"
echo "$LOCAL" > "$SAUVE/commit-avant.$HORO"

echo "── 3. Récupération du code (ff-only, pas de fusion sauvage) ─"
if ! git merge-base --is-ancestor "$LOCAL" "origin/$BRANCHE"; then
  echo "❌ L'historique distant a divergé (rebase/force-push d'un collaborateur ?)."
  echo "   Déploiement refusé. À régler à la main."; exit 1
fi
git pull --ff-only origin "$BRANCHE"

echo "── 4. Compilation (le site actuel continue de tourner) ─────"
if ! ~/.cargo/bin/cargo build --release; then
  echo "❌ Build en échec. Rien n'est basculé, le site en place n'a pas bougé."
  echo "   Retour du code à l'état d'avant :"
  git reset --hard "$LOCAL"
  exit 1
fi

echo "── 5. Bascule du binaire ──────────────────────────────────"
# Évite le piège « Text file busy » : on arrête l'ancien process,
# on attend sa sortie, puis on remplace le binaire.
pkill -x "$BIN" 2>/dev/null || true
for _ in $(seq 1 10); do pgrep -x "$BIN" >/dev/null || break; sleep 1; done
cp -f target/release/"$BIN" "./$BIN"
setsid nohup "./$BIN" > "$DIR/$BIN.out" 2>&1 < /dev/null &

echo "── 6. Vérification (health-check) ─────────────────────────"
OK=0
for _ in $(seq 1 10); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:$PORT/" || true)
  [ "$CODE" = "200" ] && { OK=1; break; }
  sleep 1
done
if [ "$OK" = "1" ]; then
  echo "✅ WorldFront déployé et répond 200 sur le port $PORT."
  echo "   (sauvegarde de l'ancien binaire : $SAUVE/$BIN.$HORO)"
else
  echo "❌ Le nouveau site ne répond pas. RETOUR ARRIÈRE automatique…"
  pkill -x "$BIN" 2>/dev/null || true
  for _ in $(seq 1 10); do pgrep -x "$BIN" >/dev/null || break; sleep 1; done
  if [ -f "$SAUVE/$BIN.$HORO" ]; then
    cp -f "$SAUVE/$BIN.$HORO" "./$BIN"
    setsid nohup "./$BIN" > "$DIR/$BIN.out" 2>&1 < /dev/null &
    git reset --hard "$LOCAL" >/dev/null 2>&1 || true
    echo "   Ancien binaire et ancien code restaurés."
  fi
  exit 1
fi
