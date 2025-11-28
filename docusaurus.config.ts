import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Keyway Documentation',
  tagline: 'GitHub-native secrets management for teams',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.keyway.sh',
  baseUrl: '/',

  organizationName: 'keywaysh',
  projectName: 'keyway-docs',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/keywaysh/keyway-docs/tree/main/',
          routeBasePath: '/', // Docs at root
        },
        blog: false, // Disable blog
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Keyway',
      logo: {
        alt: 'Keyway Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/api/overview',
          label: 'API Reference',
          position: 'left',
        },
        {
          href: 'https://keyway.sh',
          label: 'Website',
          position: 'right',
        },
        {
          href: 'https://github.com/keywaysh/keyway-cli',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/',
            },
            {
              label: 'API Reference',
              to: '/api/overview',
            },
          ],
        },
        {
          title: 'Resources',
          items: [
            {
              label: 'CLI on npm',
              href: 'https://www.npmjs.com/package/@keywaysh/cli',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/keywaysh',
            },
          ],
        },
        {
          title: 'Company',
          items: [
            {
              label: 'Website',
              href: 'https://keyway.sh',
            },
            {
              label: 'Terms of Service',
              href: 'https://keyway.sh/terms',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Keyway. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
