#!/bin/bash
# =============================================================================
# Noon Dairy Backend — VPS One-Time Server Setup Script
# =============================================================================
# Run this script ONCE on a fresh Ubuntu 22.04 VPS as root or with sudo.
# It will install everything needed: Node.js, PostgreSQL, PM2, Nginx, Certbot.
#
# Usage:
#   chmod +x scripts/server-setup.sh
#   sudo bash scripts/server-setup.sh
#
# After this script finishes, follow the steps it prints at the end.
# =============================================================================

set -e  # Stop on any error

# ── Colour helpers ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Must run as root ────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run this script with sudo: sudo bash scripts/server-setup.sh"

info "Starting Noon Dairy VPS setup..."

# ── 1. System update ────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Node.js 20 LTS ───────────────────────────────────────────────────────
info "Installing Node.js 20 LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -lt 20 ]; then
    warning "Node.js $NODE_VER found, upgrading to 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    info "Node.js $(node --version) already installed"
  fi
fi

# ── 3. PM2 ──────────────────────────────────────────────────────────────────
info "Installing PM2..."
npm install -g pm2 --quiet
pm2 startup systemd -u root --hp /root || true  # may already be set up
systemctl enable pm2-root 2>/dev/null || true

# ── 4. PostgreSQL 16 ────────────────────────────────────────────────────────
info "Installing PostgreSQL 16..."
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql postgresql-contrib
fi

systemctl enable postgresql
systemctl start postgresql

# ── 5. Create database user and database ────────────────────────────────────
info "Setting up PostgreSQL database..."

# Generate a random password if the user hasn't set one
DB_PASSWORD="${NOON_DB_PASSWORD:-$(openssl rand -hex 24)}"

# Check if user already exists
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='noon_dairy'" | grep -q 1; then
  info "Database user 'noon_dairy' already exists"
else
  info "Creating database user 'noon_dairy'..."
  sudo -u postgres psql -c "CREATE USER noon_dairy WITH PASSWORD '$DB_PASSWORD';"
fi

# Check if database already exists
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='noon_dairy_db'" | grep -q 1; then
  info "Database 'noon_dairy_db' already exists"
else
  info "Creating database 'noon_dairy_db'..."
  sudo -u postgres psql -c "CREATE DATABASE noon_dairy_db OWNER noon_dairy;"
fi

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE noon_dairy_db TO noon_dairy;"

# ── 6. Nginx ────────────────────────────────────────────────────────────────
info "Installing Nginx..."
if ! command -v nginx &>/dev/null; then
  apt-get install -y nginx
fi
systemctl enable nginx
systemctl start nginx

# ── 7. Certbot ──────────────────────────────────────────────────────────────
info "Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# ── 8. Firewall ─────────────────────────────────────────────────────────────
info "Configuring UFW firewall..."
ufw --force enable
ufw allow OpenSSH
ufw allow 'Nginx Full'
# DO NOT open port 3001 — only Nginx should proxy to it
ufw status

# ── 9. App directory ────────────────────────────────────────────────────────
APP_DIR="/var/www/noon-dairy-backend"
info "Creating app directory at $APP_DIR..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/logs"

# ── 10. Print summary ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  Server setup complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "  Database password generated: $DB_PASSWORD"
echo ""
echo -e "${YELLOW}IMPORTANT: Copy the database password above — you'll need it for .env${NC}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Copy your backend code to: $APP_DIR"
echo "     (git clone or scp from your local machine)"
echo ""
echo "  2. Create .env in $APP_DIR:"
echo "     cp .env.production.example .env"
echo "     nano .env"
echo "     → Set DATABASE_URL to: postgresql://noon_dairy:$DB_PASSWORD@localhost:5432/noon_dairy_db"
echo "     → Set JWT_SECRET, JWT_REFRESH_SECRET, SYNC_DEVICE_SECRET (random values)"
echo ""
echo "  3. Install dependencies and run migrations:"
echo "     npm install --omit=dev"
echo "     npx prisma migrate deploy"
echo ""
echo "  4. Build and start:"
echo "     npm run build"
echo "     mkdir -p logs"
echo "     pm2 start ecosystem.config.js --env production"
echo "     pm2 save"
echo ""
echo "  5. Configure Nginx (edit nginx.conf with your domain first):"
echo "     cp nginx.conf /etc/nginx/sites-available/noon-dairy"
echo "     nano /etc/nginx/sites-available/noon-dairy  ← replace 'your-domain.com'"
echo "     ln -s /etc/nginx/sites-available/noon-dairy /etc/nginx/sites-enabled/"
echo "     nginx -t && systemctl reload nginx"
echo ""
echo "  6. Get SSL certificate:"
echo "     certbot --nginx -d your-domain.com"
echo ""
echo "  7. Test:"
echo "     curl https://your-domain.com/api/health"
echo ""
echo "  8. Set up daily backups:"
echo "     bash scripts/backup-setup.sh"
echo ""
