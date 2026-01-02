#!/bin/bash
# Script to update Android app icons using Capacitor Assets

echo "Checking for icon.png..."

# Check if icon.png exists in resources/
if [ -f "resources/icon.png" ]; then
    echo "✓ Found resources/icon.png"
    
    # Generate Android icons
    echo "Generating Android icons..."
    npx @capacitor/assets generate
    
    echo ""
    echo "✓ Icons generated successfully!"
    echo "Next steps:"
    echo "1. Run: npx cap sync"
    echo "2. Rebuild your APK"
else
    echo "✗ icon.png not found in resources/ folder"
    echo ""
    echo "Please:"
    echo "1. Place your icon.png (1024x1024px minimum) in resources/icon.png"
    echo "2. Then run this script again: ./update-icons.sh"
    exit 1
fi
