import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/utils/html';

describe('escapeHtml', () => {
  it('escapes the five characters that matter in HTML text and attributes', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    );
  });

  it('escapes an ampersand once, so an existing entity stays visible as text', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('ABCDE-12345 @octocat')).toBe('ABCDE-12345 @octocat');
  });

  it('prints null and undefined as empty and other values as strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});
