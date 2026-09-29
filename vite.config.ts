import { GAME_TITLE } from './src/identity';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [
    {
      name: 'game-identity',
      transformIndexHtml: (html) => html.replace('%GAME_TITLE%', GAME_TITLE),
    },
  ],
  base: './',
  server: { watch: { ignored: ['**/tmp/**', '**/test-results/**', '**/docs/media/**'] } },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/examples/')) return 'three-effects';
          if (id.includes('/node_modules/three/')) return 'three-core';
        },
      },
    },
  },
});
