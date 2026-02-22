#!/usr/bin/env bash
# Pre-commit hook: auto-increment patch version in package.json on every commit

CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"

# Update package.json in place (portable sed)
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" package.json
else
  sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" package.json
fi

git add package.json
echo "[version] $CURRENT → $NEW_VERSION"
