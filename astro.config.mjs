import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  redirects: { '/developers': '/mcp/', '/developers/': '/mcp/' },
  integrations: [vue()],
  build: { inlineStylesheets: 'always' },
  vite: { plugins: [tailwindcss()] },
})
