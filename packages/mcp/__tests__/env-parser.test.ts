import { describe, it, expect } from 'vitest';
import { parseEnvContent, formatEnvContent } from '../src/utils/env-parser.js';

describe('parseEnvContent', () => {
  it('parses simple key-value pairs', () => {
    const content = `
DATABASE_URL=postgres://localhost:5432/db
API_KEY=secret123
`;
    const result = parseEnvContent(content);
    expect(result).toEqual({
      DATABASE_URL: 'postgres://localhost:5432/db',
      API_KEY: 'secret123',
    });
  });

  it('handles quoted values', () => {
    const content = `
MESSAGE="Hello World"
SINGLE='single quotes'
`;
    const result = parseEnvContent(content);
    expect(result).toEqual({
      MESSAGE: 'Hello World',
      SINGLE: 'single quotes',
    });
  });

  it('ignores comments', () => {
    const content = `
# This is a comment
DATABASE_URL=postgres://localhost
# Another comment
API_KEY=secret
`;
    const result = parseEnvContent(content);
    expect(result).toEqual({
      DATABASE_URL: 'postgres://localhost',
      API_KEY: 'secret',
    });
  });

  it('ignores empty lines', () => {
    const content = `
DATABASE_URL=value1

API_KEY=value2

`;
    const result = parseEnvContent(content);
    expect(result).toEqual({
      DATABASE_URL: 'value1',
      API_KEY: 'value2',
    });
  });

  it('handles empty values', () => {
    const content = `EMPTY=`;
    const result = parseEnvContent(content);
    expect(result).toEqual({
      EMPTY: '',
    });
  });

  it('handles values with equals sign', () => {
    const content = `CONNECTION=host=localhost;port=5432`;
    const result = parseEnvContent(content);
    expect(result).toEqual({
      CONNECTION: 'host=localhost;port=5432',
    });
  });
});

describe('formatEnvContent', () => {
  it('formats simple key-value pairs', () => {
    const secrets = {
      DATABASE_URL: 'postgres://localhost',
      API_KEY: 'secret',
    };
    const result = formatEnvContent(secrets);
    expect(result).toBe('DATABASE_URL=postgres://localhost\nAPI_KEY=secret');
  });

  it('quotes values with spaces', () => {
    const secrets = {
      MESSAGE: 'Hello World',
    };
    const result = formatEnvContent(secrets);
    expect(result).toBe('MESSAGE="Hello World"');
  });

  it('quotes empty values', () => {
    const secrets = {
      EMPTY: '',
    };
    const result = formatEnvContent(secrets);
    expect(result).toBe('EMPTY=""');
  });

  it('escapes quotes in values', () => {
    const secrets = {
      QUOTED: 'say "hello"',
    };
    const result = formatEnvContent(secrets);
    expect(result).toBe('QUOTED="say \\"hello\\""');
  });
});
