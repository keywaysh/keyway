# Déployer Keyway sur Railway

Railway est la solution la plus simple pour déployer Keyway. Postgres intégré, deploy automatique depuis GitHub.

## Prérequis

- Compte GitHub
- Repository Git pour Keyway

## Étapes de Déploiement

### 1. Créer un compte Railway

1. Aller sur [railway.app](https://railway.app)
2. S'inscrire avec GitHub
3. C'est tout! 🎉

### 2. Créer un nouveau projet

1. Dans Railway, cliquer sur **"New Project"**
2. Choisir **"Deploy from GitHub repo"**
3. Sélectionner votre repo `keyway-backend`
4. Railway va détecter automatiquement Node.js

### 3. Configurer le service API

Railway va créer un service. Il faut le configurer:

1. Cliquer sur le service
2. Aller dans **Settings**
3. Configurer:
   - **Root Directory**: `api`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`

### 4. Ajouter PostgreSQL

1. Dans votre projet Railway, cliquer sur **"+ New"**
2. Choisir **"Database" → "PostgreSQL"**
3. Railway va créer une DB et exposer automatiquement `DATABASE_URL`

✅ **Aucune configuration manuelle nécessaire!** Railway injecte automatiquement `DATABASE_URL` dans votre service.

### 5. Configurer les variables d'environnement

1. Cliquer sur votre service API
2. Aller dans **Variables**
3. Ajouter:

```bash
# Générer une clé de chiffrement
# Exécuter localement: openssl rand -hex 32

ENCRYPTION_KEY=votre_cle_de_64_caracteres_hex

# GitHub OAuth
GITHUB_CLIENT_ID=votre_github_client_id
GITHUB_CLIENT_SECRET=votre_github_client_secret
GITHUB_REDIRECT_URI=https://keyway-api-production.up.railway.app/auth/github/callback

# PostHog (optionnel)
POSTHOG_API_KEY=votre_posthog_api_key
POSTHOG_HOST=https://app.posthog.com

# Node
NODE_ENV=production

# Port (Railway l'injecte automatiquement, mais on le met pour être sûr)
PORT=3000
```

**Note**: Railway injecte automatiquement `DATABASE_URL` - pas besoin de le configurer!

### 6. Mettre à jour le callback GitHub OAuth

1. Aller dans GitHub Settings → Developer settings → OAuth Apps
2. Éditer votre OAuth App
3. Mettre **Authorization callback URL**: `https://votre-app.up.railway.app/auth/github/callback`
4. Sauvegarder

### 7. Exécuter les migrations

Railway n'exécute pas automatiquement les migrations. Deux options:

#### Option A: Depuis votre machine (une seule fois)

1. Copier la `DATABASE_URL` depuis Railway
2. Localement:

```bash
cd api
export DATABASE_URL="postgresql://postgres:password@region.railway.app:5432/railway"
npm run db:generate
npm run db:migrate
```

#### Option B: Ajouter au build (automatique)

Modifier `api/package.json`:

```json
{
  "scripts": {
    "build": "tsc && npm run db:migrate",
    "db:migrate": "tsx src/db/migrate.ts"
  }
}
```

**⚠️ Attention**: Cette approche exécute les migrations à chaque deploy. Pour un MVP c'est OK, mais en production il vaut mieux les exécuter manuellement.

### 8. Deploy!

Railway va automatiquement déployer à chaque push sur `main`.

Ou manuellement:

```bash
git add .
git commit -m "Deploy to Railway"
git push origin main
```

Railway va:
1. Détecter le push
2. Builder votre app
3. Exécuter les migrations (si configuré)
4. Déployer
5. Vous donner une URL: `https://keyway-api-production.up.railway.app`

### 9. Vérifier le déploiement

```bash
curl https://votre-app.up.railway.app/health
# {"status":"ok","timestamp":"2024-01-..."}
```

## Configuration du CLI

Mettre à jour `cli/.env`:

```bash
KEYWAY_API_URL=https://votre-app.up.railway.app
GITHUB_TOKEN=votre_github_token
POSTHOG_API_KEY=votre_posthog_key
```

Ou pour que le CLI utilise l'API de prod par défaut, modifier `cli/src/utils/api.ts`:

```typescript
const API_BASE_URL = process.env.KEYWAY_API_URL || 'https://keyway-api-production.up.railway.app';
```

## Monitoring & Logs

### Voir les logs

Dans Railway:
1. Cliquer sur votre service
2. Onglet **"Deployments"**
3. Logs en temps réel

### Metrics

Railway fournit automatiquement:
- CPU usage
- Memory usage
- Network
- Request count

## Coûts

- **Gratuit**: 5$ de crédit gratuit/mois (largement suffisant pour tester)
- **Hobby Plan**: 5$/mois après crédit épuisé
- **Postgres**: Inclus dans le plan

## Avantages Railway

✅ Setup en 5 minutes
✅ Postgres intégré automatiquement
✅ Deploy automatique depuis GitHub
✅ Variables d'env dans l'UI (pas besoin de CLI)
✅ Logs en temps réel
✅ Rollback en un clic
✅ Preview environments pour les PRs
✅ Scaling automatique

## Troubleshooting

### "Database connection failed"

Vérifier que Railway a injecté `DATABASE_URL`:
1. Service → Variables
2. Vérifier que `DATABASE_URL` existe (Railway l'ajoute automatiquement quand vous créez la DB)

### "Migrations not running"

Exécuter manuellement:
```bash
# Copier DATABASE_URL depuis Railway
export DATABASE_URL="..."
cd api
npm run db:migrate
```

### "Port error"

Railway utilise la variable `PORT` automatiquement. Notre code utilise déjà:
```typescript
const PORT = parseInt(process.env.PORT || '3000', 10);
```

C'est bon! ✅

## Pour aller plus loin

- Ajouter des Preview Environments pour tester les PRs
- Configurer des alertes (CPU, Memory)
- Ajouter un domaine custom
- Setup CI/CD avec GitHub Actions

## Commandes utiles

```bash
# Installer Railway CLI (optionnel)
npm i -g @railway/cli

# Login
railway login

# Lier au projet
railway link

# Voir les logs
railway logs

# Exécuter une commande sur Railway
railway run npm run db:migrate
```

## Alternative: Render

Si Railway ne convient pas, [Render](https://render.com) est une alternative similaire:
- Postgres intégré gratuit
- Deploy automatique GitHub
- Légèrement moins intuitif que Railway mais très bien

## Comparison vs Fly.io

| Feature | Railway | Fly.io |
|---------|---------|--------|
| Setup DB | 1 clic | Config manuelle |
| Deploy | Auto GitHub | `fly deploy` |
| Logs | UI temps réel | `fly logs` |
| Variables | UI | `fly secrets set` |
| Learning curve | ⭐️ Aucune | ⭐️⭐️⭐️ Moyenne |
| Prix MVP | Gratuit → 5$/mois | ~5$/mois |

**Pour un MVP: Railway gagne haut la main! 🏆**
