#!/usr/bin/env bash
# Sync a fresh build to the VPS and restart the Node service.
# Run this from your LOCAL machine after pulling the latest code.
#
# Usage:  ./deploy/deploy.sh
#
# Configure these once via env or edit below:
#   WEBINTI_HOST   ssh target, e.g. tim@1.2.3.4
#   WEBINTI_ROOT   remote install dir, default /var/www/webinti-town

set -euo pipefail

WEBINTI_HOST="${WEBINTI_HOST:?Set WEBINTI_HOST=user@host}"
WEBINTI_ROOT="${WEBINTI_ROOT:-/var/www/webinti-town}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Preparing map (default.built.tmj + tilesets)"
npm run prepare-map

echo "==> Building client (Vite prod)"
(cd client && npm ci --silent && npm run build)

echo "==> Building server (tsc)"
(cd server && npm ci --silent && npm run build)

echo "==> Syncing client/dist → $WEBINTI_HOST:$WEBINTI_ROOT/client/"
rsync -avz --delete client/dist/ "$WEBINTI_HOST:$WEBINTI_ROOT/client/"

echo "==> Syncing server (dist + package.json + node_modules)"
rsync -avz --delete \
    server/dist/ "$WEBINTI_HOST:$WEBINTI_ROOT/server/dist/"
rsync -avz \
    server/package.json server/package-lock.json \
    "$WEBINTI_HOST:$WEBINTI_ROOT/server/"

echo "==> Installing prod deps on remote + restarting"
ssh "$WEBINTI_HOST" "cd $WEBINTI_ROOT/server && npm ci --omit=dev --silent && sudo systemctl restart webinti-server"

echo "==> Deploy done. Check: ssh $WEBINTI_HOST 'journalctl -u webinti-server -f'"
