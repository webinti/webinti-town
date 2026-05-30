import Phaser from 'phaser';

// Injecté par Vite (define) à chaque build. Sert de cache-buster pour les
// assets sans hash chargés au runtime (cf. vite.config.ts).
declare const __BUILD_ID__: string;
const V = `?v=${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}`;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn('[BootScene] Asset failed to load:', file.key, file.src);
    });

    this.load.image('tileset_basic', `/assets/tilesets/basic.png${V}`);
    this.load.tilemapTiledJSON('map_default', `/maps/default.tmj${V}`);

    // F11 — kart sprite (top-down, default facing up). Optional: KartOverlay
    // falls back to a procedural sprite if this asset is missing.
    this.load.image('kart', `/assets/karts/kart.png${V}`);

    // Animated layers: rows = category * 4 directions, cols = 3 frames
    //   body  -> 96 x 576  (3 cols, 12 rows = 3 skins * 4 dirs)
    //   pants -> 96 x 1152 (3 cols, 24 rows = 6 colors * 4 dirs)
    //   shirt -> 96 x 1920 (3 cols, 40 rows = 10 colors * 4 dirs)
    // Static layers (front-facing only): hair / hair_back unchanged 192 x 288.
    this.load.spritesheet('layer_body', `/assets/avatars/body.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_hair', `/assets/avatars/hair.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_hair_back', `/assets/avatars/hair_back.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_shirt', `/assets/avatars/shirt.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_pants', `/assets/avatars/pants.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
  }

  create(): void {
    this.scene.start('GameScene');
  }
}
