import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Quickstart',
      items: [
        'quickstart/installation',
        'quickstart/first-vault',
        'quickstart/team-setup',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/cli-usage',
        'guides/environments',
        'guides/permissions',
        'guides/security',
        'guides/ci-cd',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api/overview',
        'api/authentication',
        'api/vaults',
        'api/secrets',
        'api/environments',
        'api/integrations',
        'api/users',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/cli-commands',
        'reference/error-codes',
        'reference/limits',
        'reference/plans',
      ],
    },
  ],
};

export default sidebars;
