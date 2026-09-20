import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: __dirname,
  css: {
    postcss: {},
  },
  server: {
    port: 3004,
    host: true,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        assetViewer: resolve(__dirname, 'asset-viewer.html'),
      },
    },
  },
});
