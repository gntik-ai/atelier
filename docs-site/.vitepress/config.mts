import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'In Falcone',
  description: 'Multi-tenant Backend-as-a-Service platform — documentation',
  base: '/falcone/',
  head: [
    ['meta', { name: 'theme-color', content: '#3451b2' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'In Falcone Docs' }],
    ['meta', { name: 'og:description', content: 'Multi-tenant BaaS platform documentation' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'In Falcone',

    nav: [
      { text: 'Guide', link: '/guide/what-is-falcone' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'API Reference', link: '/api/control-plane' },
      { text: 'Operations', link: '/operations/helm-configuration' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'What is In Falcone?', link: '/guide/what-is-falcone' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Quickstart', link: '/guide/quickstart' },
            { text: 'Usage Examples', link: '/guide/examples' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'Services & Components', link: '/architecture/services' },
            { text: 'Domain Model', link: '/architecture/domain-model' },
            { text: 'Security & Auth', link: '/architecture/security' },
            { text: 'Deployment Topology', link: '/architecture/deployment' },
          ],
        },
        {
          text: 'Decision Records',
          items: [
            { text: 'ADR Index', link: '/architecture/adrs' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Control Plane', link: '/api/control-plane' },
            { text: 'PostgreSQL Data API', link: '/api/postgresql' },
            { text: 'MongoDB Data API', link: '/api/mongodb' },
            { text: 'Realtime Subscriptions', link: '/api/realtime' },
            { text: 'Gateway & Routing', link: '/api/gateway' },
          ],
        },
      ],
      '/operations/': [
        {
          text: 'Operations',
          items: [
            { text: 'Helm Configuration', link: '/operations/helm-configuration' },
            { text: 'Environment Variables', link: '/operations/environment-variables' },
            { text: 'Secret Management', link: '/operations/secret-management' },
            { text: 'Observability', link: '/operations/observability' },
            { text: 'Backup & Restore', link: '/operations/backup-restore' },
          ],
        },
      ],
      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Guide', link: '/contributing/' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/gntik-ai/falcone' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2024-present In Falcone contributors',
    },

    editLink: {
      pattern: 'https://github.com/gntik-ai/falcone/edit/main/docs-site/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
