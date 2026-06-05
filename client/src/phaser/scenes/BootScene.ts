import Phaser from 'phaser';

// Injecté par Vite (define) à chaque build. Sert de cache-buster pour les
// assets sans hash chargés au runtime (cf. vite.config.ts).
declare const __BUILD_ID__: string;
const V = `?v=${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}`;
const BASE = import.meta.env.BASE_URL; // '/' en prod racine, '/v2/' pour la v2

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn('[BootScene] Asset failed to load:', file.key, file.src);
    });

    // Map prête pour le jeu, générée par `npm run prepare-map` à partir de la
    // source Tiled (default.tmj). Voir scripts/prepare-map.py.
    this.load.tilemapTiledJSON('map_default', `${BASE}maps/default.built.tmj${V}`);
    // Chargement DYNAMIQUE des tilesets : dès que le JSON de la map est lu, on
    // charge l'image de chaque tileset avec la clé `tileset_<nom>` (convention
    // attendue par GameScene). Plus besoin d'éditer ce fichier à chaque ajout.
    this.load.once('filecomplete-tilemapJSON-map_default', () => {
      const data = this.cache.tilemap.get('map_default')?.data as
        | { tilesets?: Array<{ name: string; image?: string }> }
        | undefined;
      for (const ts of data?.tilesets ?? []) {
        if (!ts.image) continue;
        const base = ts.image.split('/').pop();
        const key = `tileset_${ts.name}`;
        if (base && !this.textures.exists(key)) {
          this.load.image(key, `${BASE}assets/tilesets/${base}${V}`);
        }
      }
    });
    // Porte animée (5 frames 32x64 : fermée -> ouverte) — réservée aux portes sud.
    this.load.spritesheet('anim_door', `${BASE}assets/sprites/animated_door_1_32x32.png${V}`, {
      frameWidth: 32,
      frameHeight: 64,
    });
    // Tapis de course animé (3 frames 96x128 ; machine à l'offset tuile +1,+1).
    this.load.spritesheet('anim_treadmill', `${BASE}assets/sprites/animated_treadmill_32x32.png${V}`, {
      frameWidth: 96,
      frameHeight: 128,
    });

    // Chat animé (LimeZu, 36 frames 32x32 sur une rangée) — idle/repos en boucle.
    this.load.spritesheet('anim_cat', `${BASE}assets/sprites/animated_cat_32x32.png${V}`, {
      frameWidth: 32,
      frameHeight: 32,
    });

    // F11 — kart sprite (top-down, default facing up). Optional: KartOverlay
    // falls back to a procedural sprite if this asset is missing.
    this.load.image('kart', `${BASE}assets/karts/kart.png${V}`);

    // Couches d'avatar LimeZu (générées par scripts/build-avatars.py).
    // Toutes en frames 32x64, layout: rows = variante*4 + direction, cols = 3
    // phases [idle, walkA, walkB] (cf. avatarFrames.ts). Les 3 couches sont
    // directionnelles et animées (y compris les cheveux).
    //   body   -> 96 x 2304 (9 teints)
    //   outfit -> 96 x 3072 (12 tenues)
    //   hair   -> 96 x 6144 (6 styles x 4 couleurs = 24 variantes)
    for (const layer of ['body', 'outfit', 'hair']) {
      this.load.spritesheet(`layer_${layer}`, `${BASE}assets/avatars/${layer}.png${V}`, {
        frameWidth: 32,
        frameHeight: 64,
      });
    }
  }

  create(): void {
    this.scene.start('GameScene');
  }
}
