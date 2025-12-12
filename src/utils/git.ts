/**
 * Git utilities - detect repository from .git/config
 * Adapted from cli/src/utils/git.ts
 */

import { execSync } from 'child_process';

/**
 * Parse GitHub URL to owner/repo format
 */
function parseGitHubUrl(url: string): string | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:(.+)\/(.+)\.git/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = url.match(/https:\/\/github\.com\/(.+)\/(.+)\.git/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // HTTPS format without .git: https://github.com/owner/repo
  const httpsMatch2 = url.match(/https:\/\/github\.com\/(.+)\/(.+)/);
  if (httpsMatch2) {
    return `${httpsMatch2[1]}/${httpsMatch2[2]}`;
  }

  return null;
}

/**
 * Detect GitHub repository from current directory's git config
 * Returns owner/repo format or null if not in a git repo
 */
export function detectGitRepo(): string | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    return parseGitHubUrl(remoteUrl);
  } catch {
    return null;
  }
}

/**
 * Get the current repository name
 * Throws if not in a git repository with GitHub remote
 */
export function getRepository(): string {
  const repo = detectGitRepo();
  if (!repo) {
    throw new Error(
      'Not in a git repository with GitHub remote. Make sure you are in a project directory.'
    );
  }
  return repo;
}
