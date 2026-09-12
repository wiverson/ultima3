import { defineConfig } from 'vite';

export default defineConfig({
  // The game is pure static assets; no framework plugins are needed.
  // VITE_BASE lets a deployment under a sub-path (GitHub Pages) prefix asset URLs.
  base: process.env.VITE_BASE ?? '/',
  server: { port: 5173 },
  build: { target: 'es2022' },
  test: {
    // Game logic is tested in Node; the renderer is exercised in the browser.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
