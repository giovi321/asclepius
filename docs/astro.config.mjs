import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkMermaid from './src/plugins/remark-mermaid.mjs';

const mermaidInitScript = `
  import mermaid from 'https://esm.sh/mermaid@11.4.1';
  const isDark = document.documentElement.dataset.theme === 'dark';
  mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'loose' });
  const run = () => mermaid.run({ querySelector: 'pre.mermaid' });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
`;

export default defineConfig({
  site: 'https://giovi321.github.io',
  base: '/asclepius',
  markdown: {
    remarkPlugins: [remarkMermaid],
  },
  integrations: [
    starlight({
      title: 'Asclepius',
      description: 'Self-hosted medical records manager — documentation',
      head: [
        {
          tag: 'script',
          attrs: { type: 'module' },
          content: mermaidInitScript,
        },
      ],
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/giovi321/asclepius',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/giovi321/asclepius/edit/main/docs/',
      },
      sidebar: [
        { label: 'Home', link: '/' },
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', link: '/getting-started/installation/' },
            { label: 'Configuration', link: '/getting-started/configuration/' },
            { label: 'First Steps', link: '/getting-started/first-steps/' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Overview', link: '/architecture/overview/' },
            { label: 'Database Schema', link: '/architecture/database/' },
            { label: 'Processing Pipeline', link: '/architecture/pipeline/' },
            { label: 'Vault Structure', link: '/architecture/vault-structure/' },
          ],
        },
        {
          label: 'User Guide',
          items: [
            { label: 'Documents', link: '/user-guide/documents/' },
            { label: 'Medical Events', link: '/user-guide/medical-events/' },
            { label: 'Timeline', link: '/user-guide/timeline/' },
            { label: 'Lab Results', link: '/user-guide/lab-results/' },
            { label: 'Imaging', link: '/user-guide/imaging/' },
            { label: 'Chat', link: '/user-guide/chat/' },
            { label: 'Search', link: '/user-guide/search/' },
            { label: 'Normalization', link: '/user-guide/normalization/' },
          ],
        },
        {
          label: 'Admin Guide',
          items: [
            { label: 'User Management', link: '/admin-guide/user-management/' },
            { label: 'Session Management', link: '/admin-guide/session-management/' },
            { label: 'LLM Configuration', link: '/admin-guide/llm-configuration/' },
            { label: 'Backup & Restore', link: '/admin-guide/backup-restore/' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Authentication', link: '/api-reference/authentication/' },
            { label: 'Endpoints', link: '/api-reference/endpoints/' },
          ],
        },
        {
          label: 'Development',
          items: [
            { label: 'Setup', link: '/development/setup/' },
            { label: 'Contributing', link: '/development/contributing/' },
          ],
        },
      ],
    }),
  ],
});
