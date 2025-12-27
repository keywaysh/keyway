import { describe, it, expect } from 'vitest';
import sitemap from '../app/sitemap';

describe('sitemap', () => {
  const sitemapEntries = sitemap();
  const baseUrl = 'https://keyway.sh';

  describe('comparison pages', () => {
    const comparisonSlugs = ['doppler', 'infisical', 'vault', '1password'];

    comparisonSlugs.forEach((slug) => {
      it(`should include /vs/${slug} page`, () => {
        const entry = sitemapEntries.find((e) => e.url === `${baseUrl}/vs/${slug}`);
        expect(entry).toBeDefined();
      });
    });

    it('should have priority 0.9 for comparison pages', () => {
      const comparisonEntries = sitemapEntries.filter((e) => e.url.includes('/vs/'));
      expect(comparisonEntries.length).toBeGreaterThan(0);
      comparisonEntries.forEach((entry) => {
        expect(entry.priority).toBe(0.9);
      });
    });

    it('should have monthly change frequency for comparison pages', () => {
      const comparisonEntries = sitemapEntries.filter((e) => e.url.includes('/vs/'));
      comparisonEntries.forEach((entry) => {
        expect(entry.changeFrequency).toBe('monthly');
      });
    });
  });

  describe('core pages', () => {
    const corePages = [
      { path: '', priority: 1, changeFrequency: 'weekly', label: '/' },
      { path: '/security', priority: 0.8, changeFrequency: 'monthly', label: '/security' },
      { path: '/upgrade', priority: 0.7, changeFrequency: 'monthly', label: '/upgrade' },
      { path: '/terms', priority: 0.3, changeFrequency: 'yearly', label: '/terms' },
      { path: '/eula', priority: 0.3, changeFrequency: 'yearly', label: '/eula' },
      { path: '/privacy', priority: 0.3, changeFrequency: 'yearly', label: '/privacy' },
    ];

    corePages.forEach(({ path, priority, changeFrequency, label }) => {
      it(`should include ${label} page`, () => {
        const entry = sitemapEntries.find((e) => e.url === `${baseUrl}${path}`);
        expect(entry).toBeDefined();
      });

      it(`should have priority ${priority} for ${label}`, () => {
        const entry = sitemapEntries.find((e) => e.url === `${baseUrl}${path}`);
        expect(entry?.priority).toBe(priority);
      });

      it(`should have ${changeFrequency} change frequency for ${label}`, () => {
        const entry = sitemapEntries.find((e) => e.url === `${baseUrl}${path}`);
        expect(entry?.changeFrequency).toBe(changeFrequency);
      });
    });
  });

  describe('URL formatting', () => {
    it('should use https://keyway.sh as base URL for all entries', () => {
      sitemapEntries.forEach((entry) => {
        expect(entry.url).toMatch(/^https:\/\/keyway\.sh/);
      });
    });

    it('should not have trailing slashes on URLs', () => {
      const urlsWithTrailingSlash = sitemapEntries.filter(
        (entry) => entry.url !== baseUrl && entry.url.endsWith('/')
      );
      expect(urlsWithTrailingSlash).toHaveLength(0);
    });
  });

  describe('metadata validation', () => {
    it('should have valid Date objects for lastModified', () => {
      sitemapEntries.forEach((entry) => {
        expect(entry.lastModified).toBeInstanceOf(Date);
        expect(entry.lastModified.toString()).not.toBe('Invalid Date');
      });
    });

    it('should have priorities between 0 and 1', () => {
      sitemapEntries.forEach((entry) => {
        expect(entry.priority).toBeGreaterThanOrEqual(0);
        expect(entry.priority).toBeLessThanOrEqual(1);
      });
    });

    it('should have valid change frequencies', () => {
      const validFrequencies = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];
      sitemapEntries.forEach((entry) => {
        expect(validFrequencies).toContain(entry.changeFrequency);
      });
    });
  });

  describe('articles section', () => {
    it('should include articles index page', () => {
      const articlesIndex = sitemapEntries.find((e) => e.url === `${baseUrl}/articles`);
      expect(articlesIndex).toBeDefined();
    });

    it('should have priority 0.8 for articles index', () => {
      const articlesIndex = sitemapEntries.find((e) => e.url === `${baseUrl}/articles`);
      expect(articlesIndex?.priority).toBe(0.8);
    });

    it('should have weekly change frequency for articles index', () => {
      const articlesIndex = sitemapEntries.find((e) => e.url === `${baseUrl}/articles`);
      expect(articlesIndex?.changeFrequency).toBe('weekly');
    });

    it('should have priority 0.7 for individual articles', () => {
      const articleEntries = sitemapEntries.filter(
        (e) => e.url.startsWith(`${baseUrl}/articles/`) && e.url !== `${baseUrl}/articles`
      );
      articleEntries.forEach((entry) => {
        expect(entry.priority).toBe(0.7);
      });
    });

    it('should have monthly change frequency for individual articles', () => {
      const articleEntries = sitemapEntries.filter(
        (e) => e.url.startsWith(`${baseUrl}/articles/`) && e.url !== `${baseUrl}/articles`
      );
      articleEntries.forEach((entry) => {
        expect(entry.changeFrequency).toBe('monthly');
      });
    });
  });

  describe('sitemap completeness', () => {
    it('should have at least all core pages and comparison pages', () => {
      // 6 core pages + 4 comparison pages + 1 articles index = minimum 11 entries
      expect(sitemapEntries.length).toBeGreaterThanOrEqual(11);
    });

    it('should not have duplicate URLs', () => {
      const urls = sitemapEntries.map((entry) => entry.url);
      const uniqueUrls = new Set(urls);
      expect(urls.length).toBe(uniqueUrls.size);
    });
  });
});
