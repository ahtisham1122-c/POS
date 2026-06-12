# Noon Dairy Owner Dashboard Web

Separate React/Vite dashboard for the owner mobile/desktop website.

## Local Setup

```bash
cd owner-dashboard-web
copy .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:5174
```

## Production Build

```bash
npm run build
```

The static website is generated in:

```text
owner-dashboard-web/dist
```

## Backend URL

Set this in `.env`:

```text
VITE_API_URL=http://72.62.112.216/api
```

When using a real domain with SSL, change it to:

```text
VITE_API_URL=https://your-api-domain.com/api
```

## Domain/VPS Notes

For a separate dashboard domain, point the domain to the VPS and serve this `dist` folder with Nginx. Also add the dashboard domain to the backend `CORS_ORIGINS` value on the VPS.

Example:

```bash
cd owner-dashboard-web
npm install
npm run build
cd ..
bash owner-dashboard-web/deploy-to-vps.sh root@72.62.112.216
```

Then on the VPS:

```bash
cp /var/www/noon-dairy/noon-dairy-pos/owner-dashboard-web/deploy-nginx.example.conf /etc/nginx/sites-available/noon-dairy-dashboard
nano /etc/nginx/sites-available/noon-dairy-dashboard
ln -s /etc/nginx/sites-available/noon-dairy-dashboard /etc/nginx/sites-enabled/noon-dairy-dashboard
nginx -t && systemctl reload nginx
```

If you use a real domain, also update backend `.env`:

```text
CORS_ORIGINS="https://dashboard.your-domain.com"
```

If you still use the raw IP temporarily, use:

```text
VITE_API_URL=http://72.62.112.216/api
```
