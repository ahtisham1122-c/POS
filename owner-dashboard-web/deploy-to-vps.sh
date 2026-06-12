#!/usr/bin/env bash
set -euo pipefail

# Run from repo root after `npm run build` inside owner-dashboard-web.
# Usage:
#   bash owner-dashboard-web/deploy-to-vps.sh root@72.62.112.216

TARGET="${1:-root@72.62.112.216}"
REMOTE_DIR="/var/www/noon-dairy-dashboard"
LOCAL_DIR="owner-dashboard-web/dist"

if [ ! -d "$LOCAL_DIR" ]; then
  echo "Missing $LOCAL_DIR. Run: cd owner-dashboard-web && npm run build"
  exit 1
fi

ssh "$TARGET" "mkdir -p '$REMOTE_DIR'"
scp -r "$LOCAL_DIR"/* "$TARGET:$REMOTE_DIR/"

echo "Dashboard uploaded to $TARGET:$REMOTE_DIR"
echo "Now point Nginx/domain to $REMOTE_DIR and add the dashboard origin to backend CORS_ORIGINS."
