#!/usr/bin/env bash
# ==========================================================================
# Garden Relay Restyling — Rollback Script
# Reverses all changes made by deploy.sh
# Run as root on the relay server
# ==========================================================================
set -euo pipefail

echo "========================================"
echo "  Garden Relay — Rolling Back"
echo "========================================"
echo ""

# Stop and disable nginx
echo "Stopping nginx..."
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
echo "  ✓ nginx stopped"

# Restore pyramid.service
if [ -f /etc/systemd/system/pyramid.service.bak ]; then
    cp /etc/systemd/system/pyramid.service.bak /etc/systemd/system/pyramid.service
    echo "  ✓ pyramid.service restored"
else
    echo "  ✗ No pyramid.service backup found"
fi

# Restore settings.json
if [ -f /root/pyramid/data/settings.json.bak ]; then
    cp /root/pyramid/data/settings.json.bak /root/pyramid/data/settings.json
    echo "  ✓ settings.json restored"
else
    echo "  ✗ No settings.json backup found"
fi

# Reload and restart Pyramid
systemctl daemon-reload
systemctl restart pyramid

echo "  ✓ Pyramid restarted with original config"

# Verify
sleep 2
if systemctl is-active --quiet pyramid; then
    echo "  ✓ Pyramid is running"
else
    echo "  ✗ WARNING: Pyramid failed to start"
    echo "    Check: journalctl -u pyramid -n 20"
fi

echo ""
echo "========================================"
echo "  Rollback Complete"
echo "========================================"
echo ""
echo "Pyramid should now be accessible directly on its original port."
echo "nginx is stopped — TLS certs remain in /etc/letsencrypt/ if needed later."
