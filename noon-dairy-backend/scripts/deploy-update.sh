#!/bin/bash
# =============================================================================
# Noon Dairy — Update Deployment Script
# =============================================================================
# Run this every time you push new code to your VPS.
# Zero-downtime update: builds first, then reloads PM2.
#
# Usage (from /var/www/noon-dairy-backend):
#   git pull && bash scripts/deploy-update.sh
# =============================================================================

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }

info "Starting deployment update..."

# Install any new packages
info "Installing dependencies..."
npm install --omit=dev --silent

# Run any new database migrations
info "Running database migrations..."
npx prisma migrate deploy

# Rebuild the app
info "Building application..."
npm run build

# Make sure log directory exists
mkdir -p logs

# Reload PM2 with zero downtime
info "Reloading PM2..."
if pm2 show noon-dairy-api > /dev/null 2>&1; then
  pm2 reload noon-dairy-api
  info "PM2 reloaded successfully"
else
  warning "PM2 process not found — starting for first time..."
  pm2 start ecosystem.config.js --env production
  pm2 save
fi

# Show status
echo ""
pm2 show noon-dairy-api

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  Deployment complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "  Check health: curl http://localhost:3001/api/health"
echo "  Watch logs:   pm2 logs noon-dairy-api --lines 20"
echo ""
