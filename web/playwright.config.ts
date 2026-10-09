import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  webServer: [
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173/buscapiso/e2e/harness.html', reuseExistingServer: true },
    { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/buscapiso/', reuseExistingServer: true },
  ],
});
