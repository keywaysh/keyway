---
sidebar_position: 5
title: CI/CD Integration
---

# CI/CD Integration

Keyway integrates seamlessly with CI/CD pipelines. This guide covers common platforms.

## Authentication in CI/CD

Use a **GitHub Fine-grained Personal Access Token** for CI/CD:

1. Go to [GitHub Settings → Tokens](https://github.com/settings/tokens?type=beta)
2. Generate new token (fine-grained)
3. Select repository access
4. Required permissions: `Contents: Read`
5. Store the token as a CI secret

## GitHub Actions

### Basic setup

```yaml
name: Deploy
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Keyway CLI
        run: npm install -g @keywaysh/cli

      - name: Pull secrets
        run: keyway pull --env production --yes
        env:
          KEYWAY_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Deploy
        run: ./deploy.sh
```

### Using GitHub token

GitHub Actions provides a `GITHUB_TOKEN` automatically. For public repos or repos where the workflow has access, this works directly:

```yaml
- name: Pull secrets
  run: keyway pull --env production --yes
  env:
    KEYWAY_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Using a PAT

For cross-repo access or more control, use a PAT:

```yaml
- name: Pull secrets
  run: keyway pull --env production --yes
  env:
    KEYWAY_TOKEN: ${{ secrets.KEYWAY_PAT }}
```

### Caching the CLI

Speed up workflows by caching:

```yaml
- name: Cache Keyway CLI
  uses: actions/cache@v4
  with:
    path: ~/.npm
    key: keyway-cli-${{ runner.os }}

- name: Install Keyway CLI
  run: npm install -g @keywaysh/cli
```

## GitLab CI

```yaml
stages:
  - deploy

deploy:
  stage: deploy
  image: node:20
  before_script:
    - npm install -g @keywaysh/cli
  script:
    - keyway pull --env production --yes
    - ./deploy.sh
  variables:
    KEYWAY_TOKEN: $KEYWAY_PAT
```

Store `KEYWAY_PAT` in GitLab CI/CD Variables (Settings → CI/CD → Variables).

## CircleCI

```yaml
version: 2.1

jobs:
  deploy:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run:
          name: Install Keyway CLI
          command: npm install -g @keywaysh/cli
      - run:
          name: Pull secrets
          command: keyway pull --env production --yes
          environment:
            KEYWAY_TOKEN: ${KEYWAY_PAT}
      - run:
          name: Deploy
          command: ./deploy.sh

workflows:
  deploy:
    jobs:
      - deploy
```

Store `KEYWAY_PAT` in CircleCI Environment Variables.

## Jenkins

```groovy
pipeline {
    agent any

    environment {
        KEYWAY_TOKEN = credentials('keyway-pat')
    }

    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g @keywaysh/cli'
            }
        }

        stage('Pull Secrets') {
            steps {
                sh 'keyway pull --env production --yes'
            }
        }

        stage('Deploy') {
            steps {
                sh './deploy.sh'
            }
        }
    }
}
```

## Docker builds

### Build-time secrets

For Docker builds that need secrets:

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

# Secrets are pulled at build time
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

RUN npm run build
```

```yaml
# GitHub Actions
- name: Pull secrets
  run: keyway pull --env production --yes --output .env.build

- name: Build Docker image
  run: |
    source .env.build
    docker build \
      --build-arg DATABASE_URL=$DATABASE_URL \
      -t myapp:latest .
```

### Runtime secrets

Better approach - pull secrets at runtime:

```dockerfile
FROM node:20-alpine

WORKDIR /app
RUN npm install -g @keywaysh/cli

COPY package*.json ./
RUN npm ci
COPY . .

# Pull secrets at container start
CMD keyway pull --yes && npm start
```

## Vercel

Vercel has built-in environment variables, but you can sync from Keyway:

```yaml
# GitHub Action to sync secrets to Vercel
- name: Pull from Keyway
  run: keyway pull --env production --yes

- name: Sync to Vercel
  run: |
    while IFS='=' read -r key value; do
      vercel env add "$key" production <<< "$value"
    done < .env
  env:
    VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
```

## Best practices

### 1. Use environment-specific tokens

Create separate PATs for different environments:
- `KEYWAY_PAT_STAGING` - access to staging only
- `KEYWAY_PAT_PRODUCTION` - access to production

### 2. Minimize secret exposure

Pull secrets only when needed:

```yaml
# Good - secrets only in deploy job
jobs:
  test:
    # No secrets needed

  deploy:
    needs: test
    steps:
      - run: keyway pull --env production --yes
```

### 3. Don't log secrets

Ensure your CI doesn't log secret values:

```yaml
- name: Pull secrets
  run: keyway pull --env production --yes > /dev/null
```

### 4. Rotate CI tokens

Set calendar reminders to rotate CI/CD tokens periodically.

### 5. Use read-only access

CI/CD typically only needs to read secrets, not write them. Use read-only repository access for the PAT.
