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
  build: {
    rollupOptions: {
      output: {
        // Isole les grosses libs dans des chunks séparés : meilleur cache
        // (elles changent rarement) et téléchargement parallèle. Couplé au
        // lazy-load de PhaserGame, le chunk `phaser` (~800 kB) n'est chargé
        // qu'une fois l'utilisateur entré (après auth/join).
        manualChunks: {
          phaser: ['phaser'],
          livekit: ['livekit-client'],
          socketio: ['socket.io-client'],
        },
      },
    },
  },
});
