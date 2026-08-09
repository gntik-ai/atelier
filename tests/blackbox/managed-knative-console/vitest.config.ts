import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(repoRoot, 'apps/web-console/src'),
      '@testing-library/react': resolve(repoRoot, 'apps/web-console/node_modules/@testing-library/react'),
      '@testing-library/user-event': resolve(repoRoot, 'apps/web-console/node_modules/@testing-library/user-event'),
      'react-router-dom': resolve(repoRoot, 'apps/web-console/node_modules/react-router-dom')
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: [resolve(repoRoot, 'apps/web-console/src/test/setup.ts')],
    include: [resolve(repoRoot, 'tests/blackbox/managed-knative-console/**/*.test.tsx')],
    typecheck: {
      enabled: true,
      include: [resolve(repoRoot, 'tests/blackbox/managed-knative-console/**/*.test-d.ts')],
      tsconfig: resolve(repoRoot, 'tests/blackbox/managed-knative-console/tsconfig.json')
    }
  }
})
