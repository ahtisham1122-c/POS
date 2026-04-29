#!/bin/bash
# =============================================================================
# Noon Dairy — PostgreSQL Backup Setup
# =============================================================================
# Run this ONCE on your VPS after the app is deployed.
# It sets up an automatic daily backup at 3:00 AM (server time).
#
# Backups are stored in /var/backups/noon-dairy/
# Keeps the last 30 days of backups automatically.
#
# Usage:
#   sudo bash scripts/backup-setup.sh
# =============================================================================

set -e

GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $1"; }

[[ $EUID -ne 0 ]] && { echo "Run with sudo"; exit 1; }

BACKUP_DIR="/var/backups/noon-dairy"
BACKUP_SCRIPT="/usr/local/bin/noon-dairy-backup.sh"

info "Creating backup directory..."
mkdir -p "$BACKUP_DIR"
chown postgres:postgres "$BACKUP_DIR"

info "Creating backup script at $BACKUP_SCRIPT..."
cat > "$BACKUP_SCRIPT" << 'EOF'
#!/bin/bash
# Noon Dairy — Daily PostgreSQL backup
BACKUP_DIR="/var/backups/noon-dairy"
DATE=$(date +%Y-%m-%d_%H-%M)
FILENAME="$BACKUP_DIR/noon_dairy_db_$DATE.sql.gz"

# Create compressed backup
pg_dump -U noon_dairy noon_dairy_db | gzip > "$FILENAME"

# Keep only the last 30 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete

echo "[$(date)] Backup saved: $FILENAME ($(du -sh $FILENAME | cut -f1))"
EOF

chmod +x "$BACKUP_SCRIPT"

info "Scheduling daily backup at 3:00 AM via cron..."
# Add cron job for postgres user
(crontab -u postgres -l 2>/dev/null; echo "0 3 * * * $BACKUP_SCRIPT >> /var/log/noon-dairy-backup.log 2>&1") | sort -u | crontab -u postgres -

info "Testing backup (running now)..."
sudo -u postgres "$BACKUP_SCRIPT"

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  Backup setup complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "  Backups run every day at 3:00 AM"
echo "  Stored in: $BACKUP_DIR"
echo "  Kept for: 30 days"
echo ""
echo "  To restore a backup:"
echo "    gunzip -c /var/backups/noon-dairy/noon_dairy_db_DATE.sql.gz | sudo -u postgres psql noon_dairy_db"
echo ""
echo "  To check backup logs:"
echo "    tail -f /var/log/noon-dairy-backup.log"
echo ""
