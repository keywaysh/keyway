/**
 * .env file parsing utilities
 * Adapted from cli/src/utils/api.ts parseEnvContent
 */

/**
 * Parse .env content into key-value pairs
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1);

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) result[key] = value;
  }

  return result;
}

/**
 * Format secrets as .env content
 */
export function formatEnvContent(secrets: Record<string, string>): string {
  return Object.entries(secrets)
    .map(([key, value]) => {
      // Quote values that contain spaces, newlines, or special chars
      if (/[\s"'#]/.test(value) || value === '') {
        const escaped = value.replace(/"/g, '\\"');
        return `${key}="${escaped}"`;
      }
      return `${key}=${value}`;
    })
    .join('\n');
}
