#!/usr/bin/env bash
# Déploiement prod Webinti Town sur le VPS Hostinger (Ubuntu, systemd).
# Usage — dans la console Hostinger OU en SSH :
#   bash ~/projects/webinti-town/deploy.sh
#
# Idempotent et résilient : jette d'abord les artefacts locaux (cache de build,
# réglages) qui pourraient diverger et bloquer le `git pull`.
set -uo pipefail
cd "$(dirname "$0")" || exit 1

echo "→ git pull (origin/main)"
git checkout -- . 2>/dev/null  # discard d'éventuels artefacts locaux modifiés
git pull --ff-only || { echo "✗ pull échoué"; exit 1; }

echo "→ build (client + serveur)"
npm run build || { echo "✗ build échoué"; exit 1; }

echo "→ restart du serveur"
sudo systemctl restart webinti-server
sleep 3

echo "→ vérification"
systemctl is-active webinti-server
curl -s -o /dev/null -w "API locale → %{http_code}  (404 sur / = normal/OK)\n" http://127.0.0.1:3100/ || true
echo "✓ déployé : $(git rev-parse --short HEAD)"
