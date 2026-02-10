#!/usr/bin/env bash
# ==========================================================================
# Garden Relay Restyling — Deployment Script
# Run as root on the relay server (garden.zap.cooking)
# ==========================================================================
set -euo pipefail

DOMAIN="garden.zap.cooking"
PYRAMID_DIR="/root/pyramid"
SETTINGS="$PYRAMID_DIR/data/settings.json"
SERVICE="/etc/systemd/system/pyramid.service"
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
WEB_ROOT="/var/www/garden"
FONT_CDN="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/Geist-Regular.woff2"

echo "========================================"
echo "  Garden Relay Restyling Deployment"
echo "========================================"
echo ""

# ------------------------------------------------------------------
# Step 1: Backup current state
# ------------------------------------------------------------------
echo "[1/7] Backing up current state..."

cp "$SETTINGS" "$SETTINGS.bak"
echo "  ✓ Backed up settings.json"

cp "$SERVICE" "$SERVICE.bak"
echo "  ✓ Backed up pyramid.service"

if [ -d "$PYRAMID_DIR/certs" ]; then
    cp -r "$PYRAMID_DIR/certs" "$PYRAMID_DIR/certs.bak"
    echo "  ✓ Backed up certs/"
fi

echo ""

# ------------------------------------------------------------------
# Step 2: Update settings.json theme colors
# ------------------------------------------------------------------
echo "[2/7] Updating settings.json theme..."

# Check if jq is available, install if needed
if ! command -v jq &> /dev/null; then
    echo "  Installing jq..."
    apt-get update -y -qq
    apt-get install -y -qq jq
fi

# Update theme fields using jq
jq '
  .background_color = "#ffffff" |
  .accent_color = "#ec4700" |
  .text_color = "#4b5563" |
  .secondary_background_color = "#f9fafb" |
  .extra_color = "#ec4700" |
  .base_color = "#111827" |
  .header_transparency = 70 |
  .primary_font = "Geist" |
  .secondary_font = "Geist"
' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

echo "  ✓ Theme colors updated to zap.cooking palette"
echo ""

# ------------------------------------------------------------------
# Step 3: Reconfigure Pyramid to listen on localhost:8080
# ------------------------------------------------------------------
echo "[3/7] Reconfiguring Pyramid to localhost:8080..."

# Update HOST and PORT in the service file
sed -i 's/Environment=HOST=0\.0\.0\.0/Environment=HOST=127.0.0.1/' "$SERVICE"
sed -i 's/Environment=PORT=443/Environment=PORT=8080/' "$SERVICE"

# Also handle if they're on the same line or combined
sed -i 's/HOST=0\.0\.0\.0/HOST=127.0.0.1/g' "$SERVICE"
sed -i 's/PORT=443/PORT=8080/g' "$SERVICE"

# Remove TLS-related environment variables if present (nginx handles TLS now)
sed -i '/Environment=CERT_FILE/d' "$SERVICE" 2>/dev/null || true
sed -i '/Environment=KEY_FILE/d' "$SERVICE" 2>/dev/null || true

systemctl daemon-reload
systemctl restart pyramid

echo "  ✓ Pyramid now listening on 127.0.0.1:8080"

# Verify Pyramid is running
sleep 2
if systemctl is-active --quiet pyramid; then
    echo "  ✓ Pyramid service is active"
else
    echo "  ✗ WARNING: Pyramid service failed to start!"
    echo "    Check: journalctl -u pyramid -n 20"
    exit 1
fi
echo ""

# ------------------------------------------------------------------
# Step 4: Install nginx + certbot
# ------------------------------------------------------------------
echo "[4/7] Installing nginx and certbot..."

apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

echo "  ✓ nginx and certbot installed"
echo ""

# ------------------------------------------------------------------
# Step 5: Deploy CSS and font files
# ------------------------------------------------------------------
echo "[5/7] Deploying CSS, JS, and font files..."

mkdir -p "$WEB_ROOT/fonts"

# Copy the CSS and JS files (should be in the same directory as this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/garden-theme.css" ]; then
    cp "$SCRIPT_DIR/garden-theme.css" "$WEB_ROOT/garden-theme.css"
    echo "  ✓ garden-theme.css deployed"
else
    echo "  ✗ ERROR: garden-theme.css not found in $SCRIPT_DIR"
    exit 1
fi

if [ -f "$SCRIPT_DIR/garden-profiles.js" ]; then
    cp "$SCRIPT_DIR/garden-profiles.js" "$WEB_ROOT/garden-profiles.js"
    echo "  ✓ garden-profiles.js deployed"
else
    echo "  ✗ ERROR: garden-profiles.js not found in $SCRIPT_DIR"
    exit 1
fi

if [ -f "$SCRIPT_DIR/garden-login.js" ]; then
    cp "$SCRIPT_DIR/garden-login.js" "$WEB_ROOT/garden-login.js"
    echo "  ✓ garden-login.js deployed"
else
    echo "  ✗ ERROR: garden-login.js not found in $SCRIPT_DIR"
    exit 1
fi

if [ -f "$SCRIPT_DIR/garden-invite.js" ]; then
    cp "$SCRIPT_DIR/garden-invite.js" "$WEB_ROOT/garden-invite.js"
    echo "  ✓ garden-invite.js deployed"
else
    echo "  ✗ ERROR: garden-invite.js not found in $SCRIPT_DIR"
    exit 1
fi

# Download Geist variable font from jsDelivr
echo "  Downloading Geist font..."
curl -sL "https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/Geist-Regular.woff2" \
    -o "$WEB_ROOT/fonts/GeistVF.woff2"

# Check if download succeeded and file is not empty
if [ -s "$WEB_ROOT/fonts/GeistVF.woff2" ]; then
    echo "  ✓ GeistVF.woff2 downloaded"
else
    echo "  ✗ WARNING: Font download may have failed, trying alternative URL..."
    curl -sL "https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.0.0/files/geist-latin-wght-normal.woff2" \
        -o "$WEB_ROOT/fonts/GeistVF.woff2"
    if [ -s "$WEB_ROOT/fonts/GeistVF.woff2" ]; then
        echo "  ✓ GeistVF.woff2 downloaded (alternative source)"
    else
        echo "  ✗ WARNING: Font download failed. You may need to manually provide the font file."
    fi
fi

# Set permissions
chown -R www-data:www-data "$WEB_ROOT"
chmod -R 644 "$WEB_ROOT"/*
chmod 755 "$WEB_ROOT" "$WEB_ROOT/fonts"

echo ""

# ------------------------------------------------------------------
# Step 6: Configure nginx
# ------------------------------------------------------------------
echo "[6/7] Configuring nginx..."

# Add WebSocket upgrade map to nginx.conf if not already present
if ! grep -q 'connection_upgrade' /etc/nginx/nginx.conf; then
    # Insert the map block inside the http { } block
    sed -i '/http {/a\\n\t# WebSocket connection upgrade map\n\tmap $http_upgrade $connection_upgrade {\n\t\tdefault upgrade;\n\t\t'\'''\''      close;\n\t}' /etc/nginx/nginx.conf
    echo "  ✓ Added WebSocket upgrade map to nginx.conf"
else
    echo "  ✓ WebSocket upgrade map already present"
fi

# Deploy the site config
cp "$SCRIPT_DIR/garden.zap.cooking.nginx.conf" "$NGINX_CONF"
echo "  ✓ Site config deployed"

# Enable the site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
echo "  ✓ Site enabled"

# Remove default site if it exists
rm -f /etc/nginx/sites-enabled/default

echo ""

# ------------------------------------------------------------------
# Step 7: TLS certificate and start nginx
# ------------------------------------------------------------------
echo "[7/7] Obtaining TLS certificate and starting nginx..."

# Stop nginx temporarily if running (certbot standalone needs port 80)
systemctl stop nginx 2>/dev/null || true

# Obtain certificate
certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --preferred-challenges http \
    2>&1 | tail -3

echo "  ✓ TLS certificate obtained"

# Test nginx config
nginx -t
echo "  ✓ nginx config test passed"

# Start and enable nginx
systemctl start nginx
systemctl enable nginx

echo "  ✓ nginx started and enabled"
echo ""

# ------------------------------------------------------------------
# Verification
# ------------------------------------------------------------------
echo "========================================"
echo "  Verification"
echo "========================================"
echo ""

# Check CSS injection
echo -n "CSS injection: "
if curl -sL "https://$DOMAIN" | grep -q 'garden-theme'; then
    echo "✓ PASS"
else
    echo "✗ FAIL — garden-theme.css not found in HTML"
fi

# Check CSS file serving
echo -n "CSS file: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/garden-theme.css")
if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ PASS (HTTP $HTTP_CODE)"
else
    echo "✗ FAIL (HTTP $HTTP_CODE)"
fi

# Check login JS
echo -n "Login JS: "
LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/garden-login.js")
if [ "$LOGIN_CODE" = "200" ]; then
    echo "✓ PASS (HTTP $LOGIN_CODE)"
else
    echo "✗ FAIL (HTTP $LOGIN_CODE)"
fi

# Check invite JS
echo -n "Invite JS: "
INVITE_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/garden-invite.js")
if [ "$INVITE_CODE" = "200" ]; then
    echo "✓ PASS (HTTP $INVITE_CODE)"
else
    echo "✗ FAIL (HTTP $INVITE_CODE)"
fi

# Check NIP-11
echo -n "NIP-11: "
NIP11=$(curl -s -H "Accept: application/nostr+json" "https://$DOMAIN")
if echo "$NIP11" | grep -q '"name"'; then
    echo "✓ PASS"
else
    echo "✗ FAIL — NIP-11 response not valid"
fi

# Check font file
echo -n "Font file: "
FONT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/fonts/GeistVF.woff2")
if [ "$FONT_CODE" = "200" ]; then
    echo "✓ PASS (HTTP $FONT_CODE)"
else
    echo "✗ FAIL (HTTP $FONT_CODE)"
fi

echo ""
echo "========================================"
echo "  Deployment Complete!"
echo "========================================"
echo ""
echo "Open https://$DOMAIN in a browser to verify:"
echo "  - White background with orange accents"
echo "  - Geist font"
echo "  - Card-style member list"
echo "  - Frosted glass header"
echo "  - Login button works (NIP-07)"
echo ""
echo "Rollback if needed:"
echo "  bash $(dirname "$0")/rollback.sh"
