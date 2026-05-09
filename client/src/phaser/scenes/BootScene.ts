import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn('[BootScene] Asset failed to load:', file.key, file.src);
    });

    this.load.image('tileset_basic', '/assets/tilesets/basic.png');
    this.load.tilemapTiledJSON('map_default', '/maps/default.tmj');
    this.load.spritesheet('avatars', '/assets/avatars/avatars.png', {
      frameWidth: 32,
      frameHeight: 48,
    });
  }

  create(): void {
    this.scene.start('GameScene');
  }
}
