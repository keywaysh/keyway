#!/bin/bash

# Script de test de l'API Keyway en local

API_URL="http://localhost:3000"

echo "🧪 Test de l'API Keyway"
echo "======================="
echo ""

# Test 1: Health check
echo "1️⃣  Test Health Check..."
curl -s $API_URL/health | jq . || echo "❌ Échec"
echo ""

# Test 2: Init vault (nécessite un token GitHub)
if [ -z "$GITHUB_TOKEN" ]; then
  echo "⚠️  Passe la suite: GITHUB_TOKEN non défini"
  echo "   Pour tester init/push/pull, définis:"
  echo "   export GITHUB_TOKEN=ton_github_token"
else
  echo "2️⃣  Test Init Vault..."
  curl -s -X POST $API_URL/vaults/init \
    -H "Content-Type: application/json" \
    -d "{\"repoFullName\":\"test/repo\",\"accessToken\":\"$GITHUB_TOKEN\"}" \
    | jq . || echo "❌ Échec"
  echo ""
fi

echo "✅ Tests terminés!"
echo ""
echo "💡 Pour tester avec le CLI:"
echo "   cd ../keyway-cli"
echo "   npm run build"
echo "   npm link"
echo "   export KEYWAY_API_URL=http://localhost:3000"
echo "   export GITHUB_TOKEN=ton_token"
echo "   keyway init"
