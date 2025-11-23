# Prompt : Implémentation du Device Flow OAuth pour Keyway CLI

## Contexte

Tu travailles sur **Keyway CLI**, un gestionnaire de secrets GitHub-natif. L'API backend expose un **OAuth Device Flow** pour authentifier les utilisateurs. Tu dois implémenter la commande `keyway login` qui utilise ce flow.

## Architecture actuelle de la CLI

**Stack technique :**
- TypeScript
- Commander.js (pour les commandes CLI)
- Conf (pour stocker la config utilisateur)
- open (pour ouvrir le browser)
- chalk (pour les couleurs dans le terminal)

**Structure des fichiers :**
```
keyway-cli/
├── src/
│   ├── commands/
│   │   ├── login.ts          # À CRÉER - Commande `keyway login`
│   │   ├── init.ts           # Commande `keyway init`
│   │   ├── push.ts           # Commande `keyway push`
│   │   └── pull.ts           # Commande `keyway pull`
│   ├── lib/
│   │   ├── auth.ts           # À CRÉER - Logique d'authentification
│   │   ├── api.ts            # Client API Keyway
│   │   └── config.ts         # Gestion de la config (utilise Conf)
│   └── index.ts              # Point d'entrée CLI
└── package.json
```

## API Endpoints disponibles

### 1. POST /auth/device/start

**Démarre le device flow.**

**Request:** Aucun body

**Response:**
```typescript
{
  deviceCode: string;           // Code pour le polling (64 chars hex)
  userCode: string;             // Code à afficher (format: XXXX-XXXX)
  verificationUri: string;      // URL de base
  verificationUriComplete: string; // URL avec code pré-rempli
  expiresIn: number;            // Secondes avant expiration (900 = 15min)
  interval: number;             // Secondes entre chaque poll (5s)
}
```

### 2. POST /auth/device/poll

**Poll le statut d'autorisation.**

**Request:**
```typescript
{
  deviceCode: string;
}
```

**Responses possibles:**

**Pending (200):**
```typescript
{
  status: "pending";
}
```

**Approved (200):**
```typescript
{
  status: "approved";
  keywayToken: string;     // JWT token à sauvegarder
  githubLogin: string;     // Username GitHub
  expiresAt: string;       // Date d'expiration ISO 8601
}
```

**Expired (400):**
```typescript
{
  status: "expired";
  message: string;
}
```

**Denied (403):**
```typescript
{
  status: "denied";
  message: string;
}
```

## Tâches à implémenter

### ✅ Tâche 1 : Créer `src/lib/auth.ts`

Implémenter la fonction `loginWithDeviceFlow()` qui :

1. **Appelle POST /auth/device/start**
   - Récupère deviceCode, userCode, verificationUriComplete, interval

2. **Affiche les infos dans le terminal**
   ```
   🔐 Authenticating with Keyway...

   🔑 Code: B339-MNPH
   🌐 Opening browser for authentication...

   ℹ️  The page will auto-submit after 2 seconds
       Just click "Authorize" on GitHub!

   ⏳ Waiting for authentication...
   ```

3. **Ouvre automatiquement le browser**
   - Utilise `verificationUriComplete` (code déjà pré-rempli)
   - Utilise le package `open`
   - Gère les erreurs si le browser ne s'ouvre pas

4. **Poll POST /auth/device/poll toutes les 5 secondes**
   - Affiche un indicateur de progression (dots ou spinner)
   - Continue jusqu'à recevoir "approved", "expired" ou "denied"
   - Maximum d'attentes : expiresIn / interval

5. **Gère les réponses**
   - `approved` → Retourne le keywayToken
   - `expired` → Erreur "Code expired, run keyway login again"
   - `denied` → Erreur "Authentication denied"
   - Timeout → Erreur "Authentication timeout"

**Signature attendue :**
```typescript
export async function loginWithDeviceFlow(apiUrl: string): Promise<{
  token: string;
  githubLogin: string;
  expiresAt: string;
}>;
```

### ✅ Tâche 2 : Créer `src/commands/login.ts`

Implémenter la commande `keyway login` qui :

1. **Vérifie si déjà authentifié**
   - Lit le token depuis la config
   - Si présent et valide, affiche "Already logged in as [username]"
   - Propose `--force` pour forcer une nouvelle auth

2. **Lance le device flow**
   - Appelle `loginWithDeviceFlow()`
   - Gère les erreurs avec messages clairs

3. **Sauvegarde le token**
   - Utilise `config.set('token', token)`
   - Utilise `config.set('githubLogin', githubLogin)`
   - Utilise `config.set('expiresAt', expiresAt)`

4. **Affiche le succès**
   ```
   ✅ Successfully authenticated!

   👤 Logged in as: username
   ⏰ Token expires: 2025-12-23

   🎉 You can now use Keyway CLI:
      keyway init owner/repo
      keyway push owner/repo production
      keyway pull owner/repo production
   ```

**Signature attendue :**
```typescript
export function setupLoginCommand(program: Command): void;
```

### ✅ Tâche 3 : Modifier `src/lib/api.ts`

Ajouter l'authentification automatique pour tous les appels API.

**Avant :**
```typescript
export async function makeApiRequest(endpoint: string, options?: RequestInit) {
  const response = await fetch(`${API_URL}${endpoint}`, options);
  return response.json();
}
```

**Après :**
```typescript
export async function makeApiRequest(endpoint: string, options?: RequestInit) {
  const token = config.get('token');

  if (!token) {
    throw new Error('Not authenticated. Run: keyway login');
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options?.headers,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    throw new Error('Token expired or invalid. Run: keyway login');
  }

  return response.json();
}
```

### ✅ Tâche 4 : Ajouter une commande `keyway whoami`

Affiche les infos de l'utilisateur connecté.

```typescript
// src/commands/whoami.ts
export function setupWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Show currently authenticated user')
    .action(async () => {
      const token = config.get('token');
      const githubLogin = config.get('githubLogin');
      const expiresAt = config.get('expiresAt');

      if (!token) {
        console.log('Not authenticated. Run: keyway login');
        process.exit(1);
      }

      console.log(`Logged in as: ${githubLogin}`);
      console.log(`Token expires: ${new Date(expiresAt).toLocaleString()}`);
    });
}
```

### ✅ Tâche 5 : Ajouter une commande `keyway logout`

Supprime le token stocké.

```typescript
// src/commands/logout.ts
export function setupLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Log out of Keyway')
    .action(async () => {
      const githubLogin = config.get('githubLogin');

      config.delete('token');
      config.delete('githubLogin');
      config.delete('expiresAt');

      console.log(`✅ Logged out${githubLogin ? ` (was: ${githubLogin})` : ''}`);
    });
}
```

### ✅ Tâche 6 : Modifier `src/index.ts`

Enregistrer toutes les nouvelles commandes.

```typescript
import { setupLoginCommand } from './commands/login';
import { setupWhoamiCommand } from './commands/whoami';
import { setupLogoutCommand } from './commands/logout';

// ... autres imports ...

const program = new Command();

program
  .name('keyway')
  .description('GitHub-native secrets manager')
  .version('1.0.0');

// Register commands
setupLoginCommand(program);
setupWhoamiCommand(program);
setupLogoutCommand(program);
setupInitCommand(program);
setupPushCommand(program);
setupPullCommand(program);

program.parse();
```

## Configuration requise

### Variables d'environnement

```bash
# .env ou config
KEYWAY_API_URL=https://api.keyway.sh  # ou http://localhost:3000 en dev
```

### Storage de config

Utilise `conf` pour stocker :
```typescript
interface Config {
  token: string;        // JWT token
  githubLogin: string;  // Username GitHub
  expiresAt: string;    // Date ISO 8601
}
```

**Emplacement :** `~/.config/keyway/config.json` (gérée automatiquement par `conf`)

## Exemples d'utilisation attendue

### Premier login
```bash
$ keyway login

🔐 Authenticating with Keyway...

🔑 Code: B339-MNPH
🌐 Opening browser for authentication...

ℹ️  The page will auto-submit after 2 seconds
    Just click "Authorize" on GitHub!

⏳ Waiting for authentication...
   Polling... (1/180)

✅ Successfully authenticated!

👤 Logged in as: username
⏰ Token expires: 2025-12-23

🎉 You can now use Keyway CLI
```

### Déjà authentifié
```bash
$ keyway login

✅ Already logged in as username
   Token expires: 2025-12-23

   Use --force to login again
```

### Utiliser le token
```bash
$ keyway init myorg/myrepo
# Utilise automatiquement le token stocké
✅ Vault initialized for myorg/myrepo
```

### Whoami
```bash
$ keyway whoami
Logged in as: username
Token expires: Sat Dec 23 2025 20:49:07
```

### Logout
```bash
$ keyway logout
✅ Logged out (was: username)
```

## Gestion des erreurs

### Token expiré
```bash
$ keyway push myorg/myrepo production

❌ Token expired or invalid
   Run: keyway login
```

### Pas authentifié
```bash
$ keyway init myorg/myrepo

❌ Not authenticated
   Run: keyway login
```

### Auth refusée
```bash
$ keyway login

🔐 Authenticating with Keyway...
...

❌ Authentication denied by user
   Please try again
```

### Timeout
```bash
$ keyway login

🔐 Authenticating with Keyway...
...

❌ Authentication timeout (15 minutes)
   Please try again
```

## Tests à effectuer

1. **Login flow complet**
   - `keyway login` → Browser s'ouvre → Authorize GitHub → Token reçu

2. **Token persistance**
   - Login → Fermer terminal → Rouvrir → `keyway whoami` → Token toujours là

3. **Token dans API calls**
   - Login → `keyway init owner/repo` → Doit fonctionner avec le token

4. **Logout**
   - Login → Logout → `keyway whoami` → Doit dire "Not authenticated"

5. **Déjà authentifié**
   - Login → `keyway login` → Doit dire "Already logged in"

6. **Force re-login**
   - Login → `keyway login --force` → Redemande l'auth

7. **Token expiré**
   - Simuler un token expiré → API call → Doit demander de re-login

## Dépendances à installer

```bash
npm install open chalk ora conf
npm install -D @types/node
```

- **open** : Ouvrir le browser
- **chalk** : Couleurs dans le terminal
- **ora** : Spinner de chargement
- **conf** : Stocker la config persistante

## Exemple de code de référence

Voir le fichier `example-cli-flow.ts` dans keyway-backend pour une implémentation complète de référence.

## Points d'attention

1. **Sécurité** : Le token est un JWT sensible, ne JAMAIS le logger ni l'afficher
2. **Cross-platform** : Le package `open` gère macOS/Linux/Windows automatiquement
3. **UX** : L'auto-submit de la page de vérification se fait après 2 secondes
4. **Timeout** : Maximum 15 minutes d'attente (900s / 5s = 180 polls)
5. **Errors** : Tous les messages d'erreur doivent suggérer `keyway login` si besoin

## Critères de succès

✅ `keyway login` ouvre le browser et récupère un token
✅ Le token est sauvegardé dans `~/.config/keyway/config.json`
✅ Toutes les commandes API utilisent automatiquement le token
✅ `keyway whoami` affiche l'utilisateur connecté
✅ `keyway logout` supprime le token
✅ Les erreurs d'auth sont claires et actionnables
✅ Fonctionne sur macOS, Linux et Windows
