#!/bin/bash

# Generate SRI hashes for CDN resources used in garden relay scripts
# Run this script to update the SRI hashes when upgrading dependencies

set -e

echo "Generating SRI hashes for CDN resources..."
echo

# nostr-tools version
VERSION="1.17.0"
PACKAGE="nostr-tools"
BUNDLE_PATH="lib/nostr.bundle.js"

echo "Downloading ${PACKAGE}@${VERSION} from npm registry..."
cd "$(dirname "$0")"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

cd "$TEMP_DIR"
npm pack "${PACKAGE}@${VERSION}" > /dev/null 2>&1

echo "Extracting package..."
tar -xzf "${PACKAGE}-${VERSION}.tgz"

BUNDLE_FILE="package/${BUNDLE_PATH}"
if [ ! -f "$BUNDLE_FILE" ]; then
  echo "Error: Bundle file not found at $BUNDLE_FILE"
  exit 1
fi

echo "Calculating SRI hashes..."
SRI_384=$(openssl dgst -sha384 -binary "$BUNDLE_FILE" | openssl base64 -A)
SRI_256=$(openssl dgst -sha256 -binary "$BUNDLE_FILE" | openssl base64 -A)

echo
echo "✓ ${PACKAGE}@${VERSION}"
echo "  CDN URL: https://cdn.jsdelivr.net/npm/${PACKAGE}@${VERSION}/${BUNDLE_PATH}"
echo "  SHA-384: sha384-$SRI_384"
echo "  SHA-256: sha256-$SRI_256"
echo
echo "Update the following files with the SHA-384 hash:"
echo "  - garden-relay/garden-invite.js"
echo "  - garden-relay/garden-login.js"
echo
echo "Search for NOSTR_TOOLS_INTEGRITY and replace with:"
echo "  'sha384-$SRI_384'"
