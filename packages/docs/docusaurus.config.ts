import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import npm2yarn from "@docusaurus/remark-plugin-npm2yarn";

// Centralized URLs — self-hosters can override via environment variables
const LANDING_URL = process.env.KEYWAY_LANDING_URL || "https://keyway.sh";
const DASHBOARD_URL =
  process.env.KEYWAY_DASHBOARD_URL || "https://app.keyway.sh";
const DOCS_URL = process.env.KEYWAY_DOCS_URL || "https://docs.keyway.sh";
const API_BASE_URL = process.env.KEYWAY_API_URL || "https://api.keyway.sh";
const STATUS_URL = process.env.KEYWAY_STATUS_URL || "https://status.keyway.sh";
const GITHUB_ORG_URL =
  process.env.KEYWAY_GITHUB_ORG_URL || "https://github.com/keywaysh";
const CLI_INSTALL_URL =
  process.env.KEYWAY_CLI_INSTALL_URL || `${LANDING_URL}/install.sh`;

const config: Config = {
  title: "Keyway Documentation",
  tagline: "GitHub-native secrets management for teams",
  favicon: "img/favicon.svg",

  future: {
    v4: true,
  },

  url: DOCS_URL,
  baseUrl: "/",

  organizationName: "keywaysh",
  projectName: "keyway",

  onBrokenLinks: "throw",

  customFields: {
    apiBaseUrl: API_BASE_URL,
    dashboardUrl: DASHBOARD_URL,
    landingUrl: LANDING_URL,
    docsUrl: DOCS_URL,
    statusUrl: STATUS_URL,
    githubOrgUrl: GITHUB_ORG_URL,
    cliInstallUrl: CLI_INSTALL_URL,
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl: `${GITHUB_ORG_URL}/keyway/tree/main/packages/docs/`,
          routeBasePath: "/", // Docs at root
          remarkPlugins: [
            [npm2yarn, { sync: true, converters: ["pnpm", "yarn"] }],
          ],
        },
        blog: false, // Disable blog
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/docusaurus-social-card.jpg",
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Keyway",
      logo: {
        alt: "Keyway Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          to: "/api",
          label: "API Reference",
          position: "left",
        },
        {
          href: LANDING_URL,
          label: "Website",
          position: "right",
        },
        {
          href: GITHUB_ORG_URL,
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Documentation",
          items: [
            {
              label: "Getting Started",
              to: "/",
            },
            {
              label: "API Reference",
              to: "/api",
            },
          ],
        },
        {
          title: "Resources",
          items: [
            {
              label: "CLI on npm",
              href: "https://www.npmjs.com/package/@keywaysh/cli",
            },
            {
              label: "GitHub",
              href: GITHUB_ORG_URL,
            },
            {
              label: "Status",
              href: STATUS_URL,
            },
          ],
        },
        {
          title: "Company",
          items: [
            {
              label: "Website",
              href: LANDING_URL,
            },
            {
              label: "Terms of Service",
              href: `${LANDING_URL}/terms`,
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Keyway. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
