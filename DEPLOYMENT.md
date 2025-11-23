# 🚀 Deploiement robuste sur Railway

Guide pour déployer sans casser la production.

## ✅ Avant chaque push

**Toujours lancer la validation locale** :

```bash
pnpm run validate
```

Ce script vérifie :
- ✅ Type check TypeScript
- ✅ Build réussit
- ✅ Variables d'environnement documentées
- ✅ Migrations existent
- ✅ Endpoints critiques fonctionnent

## 🔐 Configuration GitHub OAuth (une seule fois)

L'erreur `redirect_uri is not associated` signifie que tu dois configurer tes URLs dans GitHub :

1. Va sur https://github.com/settings/developers
2. Clique sur ton OAuth App
3. Dans **Authorization callback URL**, ajoute :
   ```
   https://ton-app.railway.app/auth/device/callback
   http://localhost:3000/auth/device/callback
   ```
4. Sauvegarde

## 🎯 Workflow de déploiement

### 1. Développement local

```bash
# Faire les changements
git add .
git commit -m "feat: ma fonctionnalité"

# TOUJOURS valider avant de push
pnpm run validate

# Si tout est vert :
git push
```

### 2. GitHub Actions (automatique)

- ✅ Type check
- ✅ Build
- ✅ Migrations test
- ✅ Si tout passe → Railway déploie

### 3. Railway (automatique)

Railway fait :
1. Build avec `pnpm install --frozen-lockfile && pnpm build`
2. Migrations avec `pnpm run db:migrate`
3. Start avec `node dist/index.js`
4. Health check sur `/health`
5. Si health check fail → rollback automatique

## 🛡️ Protections en place

### Local (avant push)
- ❌ Type errors → bloqué
- ❌ Build fail → bloqué
- ❌ API tests fail → bloqué

### CI (GitHub Actions)
- ❌ Type check fail → pas de déploiement
- ❌ Build fail → pas de déploiement
- ❌ Migrations fail → pas de déploiement

### Railway
- ❌ Health check fail → rollback auto
- ❌ Crash au démarrage → garde ancienne version
- ✅ 3 retry avant d'abandonner

## 🔄 Rollback manuel

Si besoin de revenir en arrière :

```bash
# Option 1 : Railway dashboard
# Cliquer sur "Deployments" → "Redeploy" sur version précédente

# Option 2 : Git
git revert HEAD
git push

# Option 3 : Force rollback
git reset --hard HEAD~1
git push --force
```

## 📊 Monitoring

Toujours vérifier après un déploiement :

```bash
# Health check
curl https://ton-app.railway.app/health

# Test device flow
curl -X POST https://ton-app.railway.app/auth/device/start
```

## ⚠️ Variables d'environnement Railway

Assure-toi que Railway a toutes les variables :

```bash
# Dans Railway dashboard → Variables
DATABASE_URL=postgresql://...
ENCRYPTION_KEY=<64 chars hex>
JWT_SECRET=<32+ chars>
GITHUB_CLIENT_ID=<ton oauth app id>
GITHUB_CLIENT_SECRET=<ton oauth app secret>
NODE_ENV=production
ALLOWED_ORIGINS=https://ton-frontend.vercel.app
```

## 🚨 En cas de problème en production

1. **Vérifier les logs** :
   - Railway dashboard → Logs
   - Chercher les erreurs

2. **Vérifier le health check** :
   ```bash
   curl https://ton-app.railway.app/health
   ```

3. **Rollback immédiat** si critique

4. **Fix local** → validate → push

## 📝 Checklist déploiement

Avant chaque push vers main :

- [ ] `pnpm run validate` passe
- [ ] Migrations générées si changement de schéma
- [ ] `.env.example` à jour
- [ ] Tests manuels en local OK
- [ ] Commit message clair

Après chaque déploiement :

- [ ] Health check production OK
- [ ] Test device flow en production
- [ ] Logs Railway sans erreur
- [ ] Rollback plan prêt si besoin
