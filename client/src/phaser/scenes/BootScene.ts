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

    this.load.image('tileset_basic', `${BASE}assets/tilesets/basic.png${V}`);
    // POC LimeZu — tilesets Modern Office (32x32). Clé = `tileset_<nom tmj>`.
    this.load.image('tileset_room_builder', `${BASE}assets/tilesets/Room_Builder_Office_32x32.png${V}`);
    this.load.image('tileset_office_shadow', `${BASE}assets/tilesets/Modern_Office_Black_Shadow_32x32.png${V}`);
    this.load.image('tileset_office_shadowless', `${BASE}assets/tilesets/Modern_Office_Shadowless_32x32.png${V}`);
    // Réception premium — parquet bois (grand Room_Builder 76 col) + meubles cosy LivingRoom.
    this.load.image('tileset_room_builder_big', `${BASE}assets/tilesets/Room_Builder_32x32.png${V}`);
    this.load.image('tileset_livingroom', `${BASE}assets/tilesets/2_LivingRoom_Black_Shadow_32x32.png${V}`);
    // Gym — design pré-fait LimeZu (2 couches utilisées comme tilesets 19 colonnes).
    this.load.image('tileset_gym_floor', `${BASE}assets/tilesets/Gym_layer_1_32x32.png${V}`);
    this.load.image('tileset_gym_equip', `${BASE}assets/tilesets/Gym_layer_2_32x32.png${V}`);
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
    this.load.tilemapTiledJSON('map_default', `${BASE}maps/default.tmj${V}`);

    // F11 — kart sprite (top-down, default facing up). Optional: KartOverlay
    // falls back to a procedural sprite if this asset is missing.
    this.load.image('kart', `${BASE}assets/karts/kart.png${V}`);

    // Animated layers: rows = category * 4 directions, cols = 3 frames
    //   body  -> 96 x 576  (3 cols, 12 rows = 3 skins * 4 dirs)
    //   pants -> 96 x 1152 (3 cols, 24 rows = 6 colors * 4 dirs)
    //   shirt -> 96 x 1920 (3 cols, 40 rows = 10 colors * 4 dirs)
    // Static layers (front-facing only): hair / hair_back unchanged 192 x 288.
    this.load.spritesheet('layer_body', `${BASE}assets/avatars/body.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_hair', `${BASE}assets/avatars/hair.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_hair_back', `${BASE}assets/avatars/hair_back.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_shirt', `${BASE}assets/avatars/shirt.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_pants', `${BASE}assets/avatars/pants.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
  }

  create(): void {
    this.scene.start('GameScene');
  }
}
