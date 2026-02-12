# Contributing to Keyway

Thank you for your interest in contributing to Keyway! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Bugs

Before submitting a bug report:

1. Check the [existing issues](https://github.com/keywaysh/keyway-backend/issues) to avoid duplicates
2. Use the latest version of the software
3. Collect information about the bug (logs, screenshots, steps to reproduce)

When submitting a bug report, include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Environment details (OS, Node.js version, etc.)
- Relevant logs (sanitized of any secrets or sensitive data)

### Suggesting Features

We welcome feature suggestions! Please:

1. Check existing issues and discussions first
2. Provide a clear use case
3. Explain why this feature would benefit other users

### Pull Requests

#### Before You Start

1. Fork the repository
2. Create a new branch from `main`: `git checkout -b feature/your-feature-name`
3. Set up the development environment (see [README.md](README.md))

#### Development Workflow

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Run the development server**:
   ```bash
   pnpm run dev
   ```

3. **Run tests**:
   ```bash
   pnpm test
   ```

4. **Run linting**:
   ```bash
   pnpm run lint
   ```

5. **Type check**:
   ```bash
   pnpm run type-check
   ```

#### Code Style

- We use ESLint and Prettier for code formatting
- Run `pnpm run lint:fix` to auto-fix issues
- Run `pnpm run format` to format code
- Pre-commit hooks will run automatically via Husky

#### Commit Messages

Use clear, descriptive commit messages:

- `feat: add new endpoint for X`
- `fix: resolve issue with Y`
- `docs: update README`
- `refactor: simplify Z logic`
- `test: add tests for W`

#### Submitting Your PR

1. Ensure all tests pass: `pnpm test`
2. Ensure no lint errors: `pnpm run lint`
3. Ensure type checks pass: `pnpm run type-check`
4. Update documentation if needed
5. Push your branch and create a Pull Request

In your PR description:

- Describe what changes you made and why
- Link any related issues
- Include screenshots for UI changes
- Note any breaking changes

### Security Vulnerabilities

**Do not report security vulnerabilities through public issues.**

Please see [SECURITY.md](SECURITY.md) for instructions on reporting security issues responsibly.

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL database
- Docker (optional, for local development)

### Local Development

1. Copy environment file:
   ```bash
   cp .env.example .env
   ```

2. Configure your `.env` with local database credentials

3. Run database migrations:
   ```bash
   pnpm run db:migrate
   ```

4. Start the development server:
   ```bash
   pnpm run dev
   ```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage
pnpm run test:coverage
```

## Project Structure

```
src/
├── api/v1/routes/    # API route handlers
├── config/           # Configuration and constants
├── db/               # Database schema and migrations
├── errors/           # Custom error classes
├── middleware/       # Fastify middleware
├── services/         # Business logic
├── types/            # TypeScript types
└── utils/            # Utility functions
```

## Questions?

If you have questions, feel free to:

- Open a [Discussion](https://github.com/keywaysh/keyway-backend/discussions)
- Check the [Documentation](https://docs.keyway.sh)

Thank you for contributing!
