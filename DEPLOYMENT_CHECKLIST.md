# Deployment Checklist - Keyway API

## ✅ Structure du Projet (Post-Refactoring)

### Structure Actuelle (Simplifiée)
```
keyway-backend/
├── src/
│   ├── db/              # Database
│   ├── routes/          # API routes
│   ├── utils/           # Utilities
│   ├── types/           # Types (ex-shared)
│   └── index.ts         # Entry point
├── dist/                # Build output (generated)
├── drizzle/             # Migrations (generated)
├── package.json         # Standard npm (NO workspace)
├── tsconfig.json
├── Dockerfile           # ✅ Updated
├── railway.json         # ✅ Updated
└── .dockerignore        # ✅ Updated
```

### ✅ Fichiers à Jour

| Fichier | Status | Notes |
|---------|--------|-------|
| `Dockerfile` | ✅ Updated | Structure simplifiée, plus de workspace |
| `railway.json` | ✅ Updated | Build/start commands mis à jour |
| `.dockerignore` | ✅ Updated | Ignore les bons dossiers |
| `drizzle.config.ts` | ✅ OK | Pointe vers `./src/db/schema.ts` |
| `src/index.ts` | ✅ OK | PORT configuré correctement |
| `package.json` | ✅ OK | Plus de workspace |

## 🚀 Déploiement Railway

### Setup Initial (UI)

1. **Connecte ton repo GitHub**
   - Choisis "GitHub Repository"
   - Sélectionne `keyway-backend`

2. **Ajoute PostgreSQL**
   - "+ New" → Database → PostgreSQL
   - Railway injecte automatiquement `DATABASE_URL` ✅

3. **Configure les Variables d'Environnement**

   ```bash
   # Génère localement:
   openssl rand -hex 32
   ```

   Puis ajoute dans Railway → Variables:
   ```
   ENCRYPTION_KEY=<résultat_openssl>
   GITHUB_CLIENT_ID=<ton_client_id>
   GITHUB_CLIENT_SECRET=<ton_client_secret>
   GITHUB_REDIRECT_URI=https://ton-app.up.railway.app/auth/github/callback
   NODE_ENV=production
   POSTHOG_API_KEY=<optionnel>
   POSTHOG_HOST=https://app.posthog.com
   ```

   **Automatiques (Railway les injecte):**
   - ✅ `DATABASE_URL` (depuis PostgreSQL)
   - ✅ `PORT` (Railway le gère)

4. **Deploy**
   - Railway build automatiquement
   - Build command: `npm install && npm run build`
   - Start command: `npm start`

### Migrations Database

Railway ne lance pas les migrations automatiquement. **Une seule fois:**

**Option A: Depuis ta machine**
```bash
# 1. Copie DATABASE_URL depuis Railway
export DATABASE_URL="postgresql://postgres:...@region.railway.app:5432/railway"

# 2. Génère et applique les migrations
npm run db:generate
npm run db:migrate
```

**Option B: Via Railway CLI**
```bash
# Installation
npm i -g @railway/cli

# Login et link
railway login
railway link

# Migrations
railway run npm run db:generate
railway run npm run db:migrate
```

### Vérification

```bash
# Health check
curl https://ton-app.up.railway.app/health

# Devrait retourner:
# {"status":"ok","timestamp":"..."}
```


## 🐳 Test Docker en Local

Avant de déployer, teste le Dockerfile:

```bash
# Build
docker build -t keyway-api .

# Run (avec tes variables d'env)
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://..." \
  -e ENCRYPTION_KEY="..." \
  -e GITHUB_CLIENT_ID="..." \
  -e GITHUB_CLIENT_SECRET="..." \
  -e PORT=8080 \
  keyway-api

# Test
curl http://localhost:8080/health
```

## 📋 Checklist de Vérification

### Avant le Déploiement

- [ ] `npm run build` fonctionne localement
- [ ] `npm run type-check` passe
- [ ] Tous les fichiers de config sont à jour (Dockerfile, railway.json, etc.)
- [ ] `.env.example` contient toutes les variables nécessaires
- [ ] `.dockerignore` ignore les bons dossiers

### Configuration

- [ ] Base de données PostgreSQL créée
- [ ] GitHub OAuth App créée et configurée
- [ ] Toutes les variables d'env configurées
- [ ] `ENCRYPTION_KEY` généré avec `openssl rand -hex 32`
- [ ] Callback URL GitHub correspond à l'URL de déploiement

### Après le Déploiement

- [ ] L'app build sans erreur
- [ ] L'app démarre (check les logs)
- [ ] `/health` retourne `{"status":"ok"}`
- [ ] Migrations DB exécutées
- [ ] Test avec le CLI:
  ```bash
  export KEYWAY_API_URL=https://ton-app.up.railway.app
  export GITHUB_TOKEN=...
  keyway init
  ```

## 🔧 Configuration Railway

**Avantages:**
- ✅ PostgreSQL en 1 clic
- ✅ Variables d'env dans l'UI
- ✅ Deploy auto depuis GitHub
- ✅ Logs en temps réel
- ✅ Preview environments pour les PRs
- ✅ Rollback en un clic

**Build Settings:**
- Builder: Nixpacks (auto-detect)
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Root Directory: `/` (racine)
- Node Version: 18 ou 20 (auto-détecté)

## 🐛 Troubleshooting

### Build échoue

**Symptôme:** `npm install` ou `npm run build` échoue

**Solution:**
1. Vérifie que `package.json` est à la racine
2. Vérifie que `tsconfig.json` existe
3. Check les logs pour l'erreur exacte

### "DATABASE_URL is not defined"

**Solution:**
- Vérifie que PostgreSQL est créé dans Railway
- Vérifie que la DB et le service sont dans le même projet
- Railway injecte automatiquement `DATABASE_URL`

### "ENCRYPTION_KEY must be 32 bytes"

**Solution:**
```bash
openssl rand -hex 32
# Copie dans les variables d'env
```

### Migrations ne s'appliquent pas

**Solution:**
```bash
# Copie DATABASE_URL depuis Railway
export DATABASE_URL="..."

# Localement
npm run db:generate
npm run db:migrate
```

### Port déjà utilisé

Le code utilise déjà `process.env.PORT` correctement:
```typescript
const PORT = parseInt(process.env.PORT || '3000', 10);
```

Railway injecte automatiquement le bon PORT. ✅

## 📊 Variables d'Environnement Complètes

| Variable | Requis | Défaut | Notes |
|----------|--------|--------|-------|
| `PORT` | Non | 3000 | Railway l'injecte automatiquement |
| `NODE_ENV` | Non | development | Set à "production" en deploy |
| `DATABASE_URL` | **Oui** | - | PostgreSQL connection string |
| `ENCRYPTION_KEY` | **Oui** | - | 32 bytes hex (64 chars) |
| `GITHUB_CLIENT_ID` | **Oui** | - | GitHub OAuth Client ID |
| `GITHUB_CLIENT_SECRET` | **Oui** | - | GitHub OAuth Client Secret |
| `GITHUB_REDIRECT_URI` | **Oui** | - | OAuth callback URL |
| `POSTHOG_API_KEY` | Non | - | Pour analytics |
| `POSTHOG_HOST` | Non | app.posthog.com | PostHog host |
| `HOST` | Non | 0.0.0.0 | Bind address |

## 🎯 Résumé

### Structure ✅
- Plus de workspace pnpm
- Structure plate et simple
- Tous les fichiers de config à jour

### Déploiement ✅
- **Railway**: UI simple, PostgreSQL automatique, deploy depuis GitHub
- **Docker**: Dockerfile prêt si besoin d'un autre hébergeur
- **Migrations**: À lancer manuellement une fois après le premier deploy

### Configuration ✅
- `Dockerfile`: Multi-stage build optimisé
- `railway.json`: Build et start commands configurés
- `.dockerignore`: Fichiers exclus du build
- `.gitignore`: Inclut `.claude`

### CLI ✅
- Repo séparé: `/keyway-cli/`
- Configure `KEYWAY_API_URL` vers ton URL Railway
- Teste avec `keyway init`

### Prochaines Étapes

1. **Push sur GitHub** (si pas encore fait)
2. **Deploy sur Railway** (GitHub Repository)
3. **Ajouter PostgreSQL** (+ New → Database)
4. **Configurer les variables** (ENCRYPTION_KEY, GITHUB_*, etc.)
5. **Lancer les migrations** (une seule fois)
6. **Tester** (`curl https://ton-app.up.railway.app/health`)

Tout est prêt pour Railway! 🚀
