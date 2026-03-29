import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? 'dev')
  },
  build: {
    outDir: 'dist'
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/pages/**/*.tsx',
        'src/components/console/wizards/*.tsx',
        'src/components/console/DestructiveConfirmationDialog.tsx',
        'src/components/console/ConnectionSnippets.tsx',
        'src/lib/console-wizards.ts',
        'src/lib/destructive-ops.ts',
        'src/lib/snippets/*.ts'
      ]
    }
  }
})
