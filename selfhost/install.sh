#!/usr/bin/env bash
# Installeur Webinti Town self-host — génère le fichier .env de façon guidée.
# Usage :  ./install.sh
set -euo pipefail

cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }

# Secret aléatoire (openssl si dispo, sinon /dev/urandom).
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-24}";
  else head -c "${1:-24}" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# ask <var> <question> [defaut]
ask() {
  local __var="$1" __q="$2" __def="${3:-}" __ans
  if [ -n "$__def" ]; then read -r -p "$__q [$__def] : " __ans; __ans="${__ans:-$__def}";
  else read -r -p "$__q : " __ans; fi
  printf -v "$__var" '%s' "$__ans"
}

bold "── Installation Webinti Town (self-host) ──"

# 1. Pré-requis Docker
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker n'est pas installé. Installe-le : https://docs.docker.com/engine/install/"; exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  warn "Le plugin 'docker compose' est manquant."; exit 1
fi
ok "Docker et Docker Compose détectés."

# 2. Ne pas écraser un .env existant sans confirmation
if [ -f .env ]; then
  ask OVERWRITE "Un .env existe déjà. L'écraser ?" "n"
  case "$OVERWRITE" in y|Y|o|O) : ;; *) warn "Abandon (rien modifié)."; exit 0 ;; esac
fi

# 3. Questions de base
ask DOMAIN      "Domaine de l'application (ex. town.exemple.com)"
ask HOST_EMAIL  "Email du compte administrateur/hôte"
ask LICENSE_KEY "Clé de licence Webinti (fournie après souscription)"
ask LICENSE_SERVER_URL "URL du serveur de licence" "https://licenses.webinti.com"
PB_ADMIN_PASSWORD="$(gen_secret 18)"
ok "Mot de passe admin PocketBase généré."

# 4. Mode audio/vidéo
bold "Audio/vidéo — choisis le mode :"
echo "  1) LiveKit Cloud  (recommandé, rien à héberger)"
echo "  2) SFU auto-hébergé (avancé : 2e domaine + ports UDP/TCP à ouvrir)"
ask AV_MODE "Mode (1/2)" "1"

AV_BLOCK=""
if [ "$AV_MODE" = "2" ]; then
  ask LIVEKIT_DOMAIN "Domaine du SFU (ex. livekit.exemple.com)"
  LK_KEY="$(gen_secret 12)"; LK_SECRET="$(gen_secret 32)"
  ok "Clés LiveKit générées."
  AV_BLOCK=$(cat <<EOF
LIVEKIT_DOMAIN=${LIVEKIT_DOMAIN}
LIVEKIT_URL=wss://${LIVEKIT_DOMAIN}
LIVEKIT_API_KEY=${LK_KEY}
LIVEKIT_API_SECRET=${LK_SECRET}
CADDYFILE=Caddyfile.local
COMPOSE_PROFILES=local-livekit
EOF
)
else
  ask LIVEKIT_URL        "URL LiveKit Cloud (wss://...livekit.cloud)"
  ask LIVEKIT_API_KEY    "LiveKit API Key (Cloud)"
  ask LIVEKIT_API_SECRET "LiveKit API Secret (Cloud)"
  AV_BLOCK=$(cat <<EOF
LIVEKIT_URL=${LIVEKIT_URL}
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
EOF
)
fi

# 5. Écriture du .env
cat > .env <<EOF
# Généré par install.sh — modifiable à la main ensuite.
DOMAIN=${DOMAIN}
HOST_EMAIL=${HOST_EMAIL}

LICENSE_KEY=${LICENSE_KEY}
LICENSE_SERVER_URL=${LICENSE_SERVER_URL}

POCKETBASE_ADMIN_EMAIL=${HOST_EMAIL}
POCKETBASE_ADMIN_PASSWORD=${PB_ADMIN_PASSWORD}

${AV_BLOCK}

AI_API_KEY=
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=openai/gpt-4o-mini
EOF
ok ".env généré."

# 6. Lancer maintenant ?
bold "Prochaine étape : docker compose up -d --build"
ask RUN_NOW "Lancer maintenant ?" "o"
case "$RUN_NOW" in y|Y|o|O)
  docker compose up -d --build
  ok "Conteneurs lancés."
  echo "  • Admin PocketBase : https://${DOMAIN}/pb/_/  (mot de passe dans .env)"
  echo "  • Migrations       : docker compose exec server node dist/pocketbase/migrate.js"
  echo "  • App              : https://${DOMAIN}"
  ;;
*) echo "OK — lance-le quand tu veux : docker compose up -d --build" ;;
esac
