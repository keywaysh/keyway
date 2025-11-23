# Keyway - Quick Start

## 🚀 Démarrage Ultra Rapide

### Option 1: Railway (RECOMMANDÉ - Le plus simple) ⭐

**Temps estimé: 10 minutes**

Railway = Vercel pour les backends. Postgres intégré, zero config.

```bash
# 1. Push ton code sur GitHub
git add .
git commit -m "Initial commit"
git push origin main

# 2. Aller sur railway.app
# 3. "New Project" → "Deploy from GitHub repo"
# 4. Sélectionner ton repo
# 5. Ajouter PostgreSQL (bouton "+ New" → Database → PostgreSQL)
# 6. Configurer les variables d'env dans l'UI
# 7. C'est tout! 🎉
```

👉 **Guide détaillé**: [DEPLOYMENT_RAILWAY.md](./DEPLOYMENT_RAILWAY.md)

**Avantages**:
- ✅ Postgres en 1 clic
- ✅ Deploy auto depuis GitHub
- ✅ Gratuit pour commencer
- ✅ UI super intuitive (comme Vercel)

---

### Option 2: Vercel + Neon (Ce que tu connais déjà)

**Temps estimé: 15 minutes**

Nécessite d'adapter l'API en Next.js API Routes (Vercel ne supporte pas Fastify).

**Pour garder Fastify**: Utilise Railway ou Fly.io

**Si tu veux absolument rester sur Vercel**:
1. Créer un projet Next.js dans `/api`
2. Convertir les routes Fastify en API Routes
3. Utiliser Neon pour Postgres

⚠️ **Pas recommandé** car nécessite de réécrire l'API. Railway est plus simple.

---

### Option 3: Fly.io (Plus complexe)

**Temps estimé: 20-30 minutes**

Fly.io est excellent mais plus technique. Nécessite:
- Apprendre le CLI `fly`
- Configurer Postgres séparément (ou utiliser Neon)
- Gérer les secrets en ligne de commande

```bash
# Installation
curl -L https://fly.io/install.sh | sh

# Deploy
cd api
fly launch
fly secrets set ENCRYPTION_KEY="..." GITHUB_CLIENT_ID="..."
fly deploy
```

👉 **Guide détaillé**: [README.md](./README.md#deployment-to-flyio)

**Avantages**:
- ✅ Très performant
- ✅ Géolocalisation mondiale
- ✅ Scale facilement

**Inconvénients**:
- ❌ Plus de commandes à apprendre
- ❌ DB à configurer séparément
- ❌ Courbe d'apprentissage

---

## 🔧 Setup Local (Développement)

### 1. Installer les dépendances

```bash
npm install
npm run build
```

### 2. Base de données

**Option A: PostgreSQL local**

```bash
# macOS avec Homebrew
brew install postgresql
brew services start postgresql
createdb keyway
```

**Option B: Neon (Recommandé)**

1. Aller sur [neon.tech](https://neon.tech)
2. Créer un projet
3. Copier la connection string

### 3. Configurer les variables d'environnement

```bash
# API
cd api
cp .env.example .env

# Générer une clé de chiffrement
openssl rand -hex 32

# Éditer api/.env avec:
# - DATABASE_URL (Neon ou local)
# - ENCRYPTION_KEY (résultat de openssl)
# - GITHUB_CLIENT_ID et GITHUB_CLIENT_SECRET
```

**Créer une GitHub OAuth App**:
1. GitHub Settings → Developer settings → OAuth Apps → New
2. Callback URL: `http://localhost:3000/auth/github/callback`
3. Copier Client ID et Secret

### 4. Migrations

```bash
cd api
npm run db:generate  # Générer les migrations
npm run db:migrate   # Exécuter les migrations
```

### 5. Lancer l'API

```bash
npm run dev:api
```

L'API tourne sur `http://localhost:3000`

### 6. Tester le CLI

```bash
# Dans un autre terminal
cd cli

# Configurer le CLI
cp .env.example .env
# Éditer cli/.env avec ton GITHUB_TOKEN

# Tester
npm run dev -- init
npm run dev -- push
npm run dev -- pull
```

---

## 📊 Comparaison des Hébergeurs

| Critère | Railway | Fly.io | Vercel |
|---------|---------|--------|--------|
| **Simplicité** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Setup DB** | 1 clic | Manuel | Neon (séparé) |
| **Deploy** | Auto GitHub | CLI | Auto GitHub |
| **Prix gratuit** | 5$/mois crédit | 5$/mois | Serverless only |
| **Fastify** | ✅ Oui | ✅ Oui | ❌ Non |
| **Learning curve** | 5 min | 30 min | 10 min |
| **Recommandé pour** | MVP, Rapidité | Production, Scale | Frontend, Serverless |

## 🎯 Recommandation

### Pour un MVP / Simplicité maximale
➡️ **Railway** - Setup en 10 minutes, zero configuration

### Pour garder ce que tu connais
➡️ **Vercel + Neon** - Mais nécessite de réécrire l'API en Next.js

### Pour une app production dès le début
➡️ **Fly.io** - Plus de contrôle, meilleure performance

---

## ⚡ TL;DR

**Le plus rapide (5 commandes)**:

```bash
# 1. Push sur GitHub
git push origin main

# 2. Aller sur railway.app
# 3. "New Project" → GitHub repo
# 4. "+ New" → PostgreSQL
# 5. Ajouter les variables d'env dans l'UI

# ✅ Done!
```

**Mon conseil**: Commence avec Railway, tu pourras migrer vers Fly.io plus tard si besoin.
