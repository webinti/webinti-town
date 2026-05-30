import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // Injecté à chaque build : sert de cache-buster pour les assets chargés au
  // runtime par Phaser (tilemap, tileset, sprites) qui n'ont pas de hash dans
  // leur URL et que nginx met en cache (30d pour /assets, 1h pour /maps).
  define: {
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
});
