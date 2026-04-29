# Noon Dairy Backend — VPS Deployment Guide

## What This Guide Covers

Deploying the Noon Dairy NestJS backend to a VPS (Hetzner or DigitalOcean)
with local PostgreSQL, PM2, Nginx, and free SSL. Everything runs on one server.
Cost: ~$6-7/month. No Supabase. No external database service.

---

## Step 1 — Create a VPS

**Recommended providers:**
- **Hetzner** → https://www.hetzner.com/cloud  (cheapest, Germany/Finland)
- **DigitalOcean** → https://www.digitalocean.com  (Singapore = faster for Pakistan)
- **Vultr** → https://www.vultr.com  (has Mumbai/Singapore regions)

**Server specs to select:**
- OS: Ubuntu 22.04 LTS
- Plan: 2 vCPU / 4 GB RAM (Hetzner CX22 ~EUR4/mo, DigitalOcean Basic ~$12/mo)
- Storage: 40 GB SSD
- Region: Singapore or Mumbai for Pakistan

After creating, you get a server **IP address** like `167.99.123.45`.

---

## Step 2 — Point a Domain at the Server (Recommended)

If you have a domain (e.g. `noonapi.com`):
1. Go to your registrar (Namecheap, GoDaddy, etc.)
2. Add an A record: `@` pointing to your server IP
3. Add an A record: `api` pointing to your server IP

No domain? You can use the raw IP — just skip the SSL step later.

---

## Step 3 — Push Your Code to GitHub

```bash
# On your local machine from the backend folder:
git add .
git commit -m "production ready"
git push
```

---

## Step 4 — SSH into Your Server

```bash
ssh root@YOUR_SERVER_IP
```

On Windows use PuTTY or Windows Terminal with SSH.

---

## Step 5 — Run the Setup Script

This single script installs everything: Node.js 20, PostgreSQL, PM2, Nginx, Certbot,
and creates the database user and database automatically.

```bash
# Clone your repo onto the server
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /var/www/noon-dairy-backend
cd /var/www/noon-dairy-backend/noon-dairy-backend

# Run setup (takes about 3-4 minutes)
sudo bash scripts/server-setup.sh
```

**The script prints a database password at the end — copy it, you need it in the next step.**

---

## Step 6 — Create the .env File

```bash
cp .env.production.example .env
nano .env
```

Fill in these values:

```
DATABASE_URL="postgresql://noon_dairy:PASTE_DB_PASSWORD_HERE@localhost:5432/noon_dairy_db"
JWT_SECRET="GENERATE_RANDOM_VALUE_SEE_BELOW"
JWT_REFRESH_SECRET="GENERATE_DIFFERENT_RANDOM_VALUE"
SYNC_DEVICE_SECRET="GENERATE_RANDOM_VALUE"
PORT=3001
NODE_ENV=production
CORS_ORIGINS="https://your-domain.com"
```

**Generate random secrets** — run this command 3 times, use a different output for each secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Save and exit nano: `Ctrl+X` then `Y` then `Enter`

---

## Step 7 — Install, Migrate, Build, Start

```bash
# Install production Node packages
npm install --omit=dev

# Create all database tables
npx prisma migrate deploy

# Build the TypeScript app
npm run build

# Create log folder
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.js --env production
pm2 save

# Verify it's running
pm2 status
```

You should see `noon-dairy-api` with status `online`.

---

## Step 8 — Configure Nginx

```bash
# Copy the config file
cp nginx.conf /etc/nginx/sites-available/noon-dairy

# Edit: replace every "your-domain.com" with your actual domain
nano /etc/nginx/sites-available/noon-dairy

# Enable it
ln -s /etc/nginx/sites-available/noon-dairy /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Step 9 — Get Free SSL (Only if You Have a Domain)

```bash
certbot --nginx -d your-domain.com
```

Follow the prompts. Certbot auto-renews every 90 days — nothing to maintain.

---

## Step 10 — Set Up Daily Backups

```bash
sudo bash scripts/backup-setup.sh
```

Creates daily compressed PostgreSQL backups at 3 AM server time.
Keeps the last 30 days. Stored in `/var/backups/noon-dairy/`.

---

## Step 11 — Test Everything

```bash
# Health check
curl https://your-domain.com/api/health

# Expected:
# {"status":"ok","uptime":42,"services":{"database":"ok"}}

# PM2 status
pm2 status

# Live logs
pm2 logs noon-dairy-api --lines 30
```

---

## Step 12 — Connect the Electron App

In the Electron app go to **Settings > Sync** and enter:
- **API URL:** `https://your-domain.com/api`
- **Device Secret:** the exact value of `SYNC_DEVICE_SECRET` from your server `.env`

Click **Sync Now** — status badge turns green.

---

## Pushing Updates (Every Time You Change Code)

```bash
# On your VPS:
cd /var/www/noon-dairy-backend/noon-dairy-backend
git pull
bash scripts/deploy-update.sh
```

The script handles: install packages, run migrations, build, reload PM2 with zero downtime.

---

## Restore a Backup

```bash
# List backups
ls /var/backups/noon-dairy/

# Restore a specific backup
gunzip -c /var/backups/noon-dairy/noon_dairy_db_2026-04-29_03-00.sql.gz \
  | sudo -u postgres psql noon_dairy_db
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App won't start | `pm2 logs noon-dairy-api --err` — look for missing .env values |
| Startup fails: "JWT_SECRET must be set" | Replace placeholder secrets in `.env` with real random values |
| Database connection refused | `systemctl status postgresql` — restart if stopped |
| Nginx 502 Bad Gateway | App crashed — run `pm2 restart noon-dairy-api` and check `pm2 logs` |
| Sync 401 error | `SYNC_DEVICE_SECRET` mismatch between server and Electron app |
| Sync 429 error | Rate limit hit — check Electron sync interval is `5000` ms not `5` ms |
| SSL cert failed | DNS A record must point to server IP before running certbot |
| Migrations fail | Run `npx prisma db push` as fallback for first-time deploy |

---

## Useful Daily Commands

```bash
pm2 status                     # Is the app running?
pm2 logs noon-dairy-api        # Live log stream
pm2 logs noon-dairy-api --err  # Errors only
pm2 restart noon-dairy-api     # Restart (brief downtime)
pm2 reload noon-dairy-api      # Zero-downtime reload

systemctl status postgresql    # Is the database running?
systemctl restart postgresql   # Restart database

nginx -t                       # Test Nginx config before reloading
systemctl reload nginx         # Apply Nginx config changes

ls /var/backups/noon-dairy/    # List available backups
```
