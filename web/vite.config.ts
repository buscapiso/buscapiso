import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  // Se publica en https://buscapiso.github.io/buscapiso/
  base: '/buscapiso/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', '../extension/test/**/*.test.js'],
  },
});
