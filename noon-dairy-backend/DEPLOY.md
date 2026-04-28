# Noon Dairy Backend — Production Deployment Guide

## Server Requirements
- Ubuntu 22.04 LTS (or similar)
- Node.js 20 LTS
- PM2 (process manager)
- Nginx (reverse proxy)
- A PostgreSQL database (Supabase recommended)

---

## One-Time Server Setup

### 1. Install Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Install PM2
```bash
sudo npm install -g pm2
pm2 startup   # follow the printed command to enable autostart
```

### 3. Install Nginx
```bash
sudo apt install nginx -y
```

### 4. Install Certbot (free SSL)
```bash
sudo apt install certbot python3-certbot-nginx -y
```

---

## First Deployment

### 1. Clone / copy the backend to the server
```bash
git clone <your-repo> /var/www/noon-dairy-backend
cd /var/www/noon-dairy-backend/noon-dairy-backend
```

### 2. Create your .env file
```bash
cp .env.production.example .env
nano .env   # fill in all values
```

**Generate strong secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Run this 3 times — one value each for `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SYNC_DEVICE_SECRET`.

**Important:** Copy the `SYNC_DEVICE_SECRET` value into the Electron app's
`Settings > Sync` page so the desktop can authenticate with this server.

### 3. Install dependencies
```bash
npm install --omit=dev
```

### 4. Set up the database

**If this is a brand-new Supabase database:**
```bash
npx prisma migrate deploy
```

**If the database already has tables from `db push`:**
```bash
# Mark the initial migration as already applied (no SQL will run)
npx prisma migrate resolve --applied 20260429000000_init_production_schema
```

### 5. Build the app
```bash
npm run build
```

### 6. Create log directory
```bash
mkdir -p logs
```

### 7. Start with PM2
```bash
pm2 start ecosystem.config.js --env production
pm2 save
```

### 8. Configure Nginx
```bash
sudo cp nginx.conf /etc/nginx/sites-available/noon-dairy
# Edit the file and replace "your-domain.com" with your actual domain
sudo nano /etc/nginx/sites-available/noon-dairy

sudo ln -s /etc/nginx/sites-available/noon-dairy /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 9. Get SSL certificate
```bash
sudo certbot --nginx -d your-domain.com
```

---

## Verifying the Deployment

```bash
# Check the server is running
curl https://your-domain.com/api/health

# Expected response:
# {"status":"ok","uptime":42,"services":{"database":"ok"}}

# Check PM2 status
pm2 status

# Watch live logs
pm2 logs noon-dairy-api --lines 50
```

---

## Updating the Backend (Subsequent Deploys)

```bash
cd /var/www/noon-dairy-backend/noon-dairy-backend

# Pull latest code
git pull

# Install any new packages
npm install --omit=dev

# Run any new migrations
npx prisma migrate deploy

# Build
npm run build

# Reload PM2 (zero-downtime)
pm2 reload noon-dairy-api
```

---

## Connecting the Electron App

In the Electron app go to **Settings > Sync** and set:
- **API URL:** `https://your-domain.com/api`
- **Sync Secret:** must match `SYNC_DEVICE_SECRET` in the server `.env`

Then click **Sync Now** — the status badge should turn green.

---

## Troubleshooting

| Problem | Command |
|---------|---------|
| App won't start | `pm2 logs noon-dairy-api --err` |
| Database error | Check `DATABASE_URL` in `.env`, run `npx prisma db pull` to test connection |
| Sync 401 error | `SYNC_DEVICE_SECRET` mismatch between Electron and server |
| Sync 429 error | Rate limit hit — check Electron sync interval (should be 5 s, not ms) |
| Nginx 502 | `pm2 status` — app may be crashed, check `pm2 logs` |
