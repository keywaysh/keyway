---
sidebar_position: 5
title: CI/CD
---

# CI/CD Integration

## Authentication

### API Keys

CI/CD authenticates with a Keyway API key (`kw_live_…`):

1. Create an API key in your [Dashboard](https://app.keyway.sh/api-keys)
2. Select `read:secrets` scope (least privilege for pulling); add `write:secrets` only if the job pushes
3. Set an expiration date (up to 1 year)
4. Add as a CI secret named `KEYWAY_TOKEN`

API keys have scoped permissions (read-only possible), grant no GitHub access, can be revoked at any time, and expire. See [API Keys](./api#api-keys) for scopes and IP restrictions.

### GitHub tokens are not accepted

GitHub personal access tokens (`ghp_…`, `github_pat_…`) and other GitHub tokens are rejected with `401`. Keyway checks repository access with its own GitHub App and your GitHub username, so accepting any GitHub token would let a token you gave another tool, or one with no permissions at all, read every secret you can reach.

If your pipeline still sets `KEYWAY_TOKEN` to a GitHub token, create an API key as described above and replace the value of the `KEYWAY_TOKEN` secret with it. No workflow change is needed. See [Security](./security#github-tokens-are-not-accepted) for details.

---

## GitHub Actions

### Keyway Action (Recommended)

```yaml
name: Deploy
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: keywaysh/keyway-action@v1
        with:
          token: ${{ secrets.KEYWAY_TOKEN }}
          environment: production

      - run: ./deploy.sh  # Secrets are in env vars
```

The action pulls secrets, exports them as env vars, and masks values in logs.

### Action Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `token` | required | Keyway API key (`kw_live_…`) |
| `environment` | `cicd` | Vault environment |
| `export-env` | `true` | Export as env vars |
| `env-file` | - | Write to .env file |
| `mask-values` | `true` | Mask in logs |

:::tip cicd environment
The action defaults to `cicd` environment. Create this environment in your vault with the secrets needed for CI/CD, or override with `environment: production`.
:::

### Write to File

```yaml
- uses: keywaysh/keyway-action@v1
  with:
    token: ${{ secrets.KEYWAY_TOKEN }}
    env-file: .env
    export-env: false
```

### Using CLI Directly

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'

- run: npm install -g @keywaysh/cli

- run: keyway pull -e production -y
  env:
    KEYWAY_TOKEN: ${{ secrets.KEYWAY_TOKEN }}
```

### Multiple Environments

```yaml
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: keywaysh/keyway-action@v1
        with:
          token: ${{ secrets.KEYWAY_TOKEN }}
          environment: staging

  deploy-production:
    runs-on: ubuntu-latest
    needs: deploy-staging
    steps:
      - uses: keywaysh/keyway-action@v1
        with:
          token: ${{ secrets.KEYWAY_TOKEN }}
          environment: production
```

---

## GitLab CI

```yaml
deploy:
  image: node:20
  before_script:
    - npm install -g @keywaysh/cli
  script:
    - keyway pull -e production -y
    - ./deploy.sh
  variables:
    KEYWAY_TOKEN: $KEYWAY_TOKEN
```

Store `KEYWAY_TOKEN` in Settings -> CI/CD -> Variables (masked).

---

## CircleCI

```yaml
version: 2.1

jobs:
  deploy:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run: npm install -g @keywaysh/cli
      - run:
          command: keyway pull -e production -y
          environment:
            KEYWAY_TOKEN: ${KEYWAY_TOKEN}
      - run: ./deploy.sh
```

Add `KEYWAY_TOKEN` in Project Settings -> Environment Variables.

---

## Jenkins

```groovy
pipeline {
    agent any
    environment {
        KEYWAY_TOKEN = credentials('keyway-token')
    }
    stages {
        stage('Setup') {
            steps { sh 'npm install -g @keywaysh/cli' }
        }
        stage('Pull') {
            steps { sh 'keyway pull -e production -y' }
        }
        stage('Deploy') {
            steps { sh './deploy.sh' }
        }
    }
}
```

Add `keyway-token` as a Secret Text credential.

---

## Docker

### Runtime (Recommended)

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN npm install -g @keywaysh/cli
COPY . .
CMD keyway pull -y && npm start
```

Pass the token at runtime:
```bash
docker run -e KEYWAY_TOKEN=kw_live_xxx myapp
```

### Build-time

```yaml
- run: keyway pull -e production -y -f .env.build

- run: |
    source .env.build
    docker build --build-arg DATABASE_URL=$DATABASE_URL -t app .
```

:::caution
Build-time secrets may be cached in image layers. Prefer runtime injection.
:::

---

## Kubernetes

### Using init containers

```yaml
apiVersion: v1
kind: Pod
spec:
  initContainers:
    - name: keyway
      image: node:20-alpine
      command: ['sh', '-c', 'npm install -g @keywaysh/cli && keyway pull -y -f /secrets/.env']
      env:
        - name: KEYWAY_TOKEN
          valueFrom:
            secretKeyRef:
              name: keyway-token
              key: token
      volumeMounts:
        - name: secrets
          mountPath: /secrets
  containers:
    - name: app
      image: myapp
      envFrom:
        - secretRef:
            name: app-secrets
      volumeMounts:
        - name: secrets
          mountPath: /secrets
  volumes:
    - name: secrets
      emptyDir: {}
```

### External Secrets Operator

Coming soon: Native ESO integration.

---

## Best Practices

1. **Use API keys** - Scoped, revocable, and expiring
2. **Least privilege** - Use `read:secrets` scope for pulling
3. **Set expiration** - API keys should expire within 1 year
4. **Separate environments** - Different secrets for staging/production
5. **Pull only when needed** - Skip in test jobs that don't need secrets
6. **Don't log secrets** - Action masks by default, use `> /dev/null` with CLI
7. **Rotate regularly** - Refresh tokens after team changes

---

## Troubleshooting

### "API key missing required scope"

Your API key doesn't have the required scope. Create a new key with `read:secrets` for pulling or `write:secrets` for pushing.

### "GitHub tokens are not accepted"

`KEYWAY_TOKEN` holds a GitHub token (`ghp_…`, `github_pat_…`). Replace it with a Keyway API key: see [GitHub tokens are not accepted](#github-tokens-are-not-accepted).

### "Vault not found"

Run `keyway init` locally first to create the vault, or check the repository name is correct.

### "Token expired"

Create a new API key and update your CI secrets.

### Rate limiting

If you're hitting rate limits, consider:
- Caching secrets between steps
- Using environment files instead of pulling multiple times
- Contacting support for increased limits
