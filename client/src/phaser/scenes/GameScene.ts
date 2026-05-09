import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import type { PlayerState } from '../../types';

const TILE = 32;
const DEFAULT_MAP_W = 60;
const DEFAULT_MAP_H = 42;
const DEFAULT_SPAWN_X = 320;
const DEFAULT_SPAWN_Y = 256;

export class GameScene extends Phaser.Scene {
  private player?: Player;
  private remotePlayers = new Map<string, RemotePlayer>();
  private wasdKeys?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  private furnitureLayer?: Phaser.Tilemaps.TilemapLayer;
  private wallsGroup?: Phaser.Physics.Arcade.StaticGroup;
  private mapW = DEFAULT_MAP_W;
  private mapH = DEFAULT_MAP_H;
  private hasLayers = false;
  private lastSentX = -9999;
  private lastSentY = -9999;
  private lastSentDir = '';
  private lastSentMoving = false;
  private unsubUpdate?: () => void;
  private unsubRemove?: () => void;
  private unsubStore?: () => void;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.hasLayers =
      this.textures.exists('layer_body') &&
      this.textures.exists('layer_hair') &&
      this.textures.exists('layer_shirt') &&
      this.textures.exists('layer_pants');

    const tilemapKey = 'map_default';
    const cacheHasMap = this.cache.tilemap.has(tilemapKey);
    const hasTileset = this.textures.exists('tileset_basic');

    if (cacheHasMap && hasTileset) {
      this.buildTilemap();
    } else {
      this.buildFallbackMap();
    }

    const worldW = this.mapW * TILE;
    const worldH = this.mapH * TILE;
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    const store = useGameStore.getState();
    const localId = store.localPlayerId;
    const localState = localId ? store.players.get(localId) : undefined;
    const startX = localState?.x ?? DEFAULT_SPAWN_X;
    const startY = localState?.y ?? DEFAULT_SPAWN_Y;

    this.player = new Player(
      this,
      startX,
      startY,
      store.appearance,
      store.name || 'Vous',
      this.hasLayers,
    );

    if (this.wallsLayer) {
      this.physics.add.collider(this.player.sprite, this.wallsLayer);
    }
    if (this.furnitureLayer) {
      this.physics.add.collider(this.player.sprite, this.furnitureLayer);
    }
    if (this.wallsGroup) {
      this.physics.add.collider(this.player.sprite, this.wallsGroup);
    }

    this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);

    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasdKeys = this.input.keyboard?.addKeys('W,A,S,D') as Record<
      'W' | 'A' | 'S' | 'D',
      Phaser.Input.Keyboard.Key
    >;

    for (const [id, p] of store.players) {
      if (id !== localId) this.spawnRemote(p);
    }

    this.unsubUpdate = socketManager.onPlayerUpdate((p) => this.handleRemoteUpdate(p));
    this.unsubRemove = socketManager.onPlayerRemoved((id) => this.handleRemoteRemove(id));

    this.unsubStore = useGameStore.subscribe((s) => {
      const lid = s.localPlayerId;
      for (const [id, p] of s.players) {
        if (id === lid) continue;
        const existing = this.remotePlayers.get(id);
        if (existing) existing.setTarget(p);
        else this.spawnRemote(p);
      }
      for (const id of this.remotePlayers.keys()) {
        if (!s.players.has(id)) this.handleRemoteRemove(id);
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubUpdate?.();
      this.unsubRemove?.();
      this.unsubStore?.();
    });
  }

  private buildTilemap(): void {
    const map = this.make.tilemap({ key: 'map_default' });
    this.mapW = map.width;
    this.mapH = map.height;
    const tilesetName = map.tilesets[0]?.name ?? 'basic';
    const tileset = map.addTilesetImage(tilesetName, 'tileset_basic');
    if (!tileset) {
      this.buildFallbackMap();
      return;
    }
    for (const layerData of map.layers) {
      const layer = map.createLayer(layerData.name, tileset, 0, 0);
      if (!layer) continue;
      const name = layerData.name.toLowerCase();
      if (/wall|collide|collision/.test(name)) {
        layer.setCollisionByProperty({ collides: true });
        this.wallsLayer = layer;
      } else if (/furniture/.test(name)) {
        layer.setCollisionByProperty({ collides: true });
        this.furnitureLayer = layer;
      }
    }
  }

  private buildFallbackMap(): void {
    const g = this.add.graphics();
    for (let y = 0; y < this.mapH; y++) {
      for (let x = 0; x < this.mapW; x++) {
        const isBorder = x === 0 || y === 0 || x === this.mapW - 1 || y === this.mapH - 1;
        const color = isBorder ? 0x334155 : (x + y) % 2 === 0 ? 0x1f8a4c : 0x22a55a;
        g.fillStyle(color, 1);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    g.lineStyle(1, 0x000000, 0.06);
    for (let x = 0; x <= this.mapW; x++) {
      g.lineBetween(x * TILE, 0, x * TILE, this.mapH * TILE);
    }
    for (let y = 0; y <= this.mapH; y++) {
      g.lineBetween(0, y * TILE, this.mapW * TILE, y * TILE);
    }

    const walls = this.physics.add.staticGroup();
    for (let x = 0; x < this.mapW; x++) {
      walls.create(x * TILE + TILE / 2, TILE / 2, '').setSize(TILE, TILE).setVisible(false).refreshBody();
      walls.create(x * TILE + TILE / 2, (this.mapH - 1) * TILE + TILE / 2, '').setSize(TILE, TILE).setVisible(false).refreshBody();
    }
    for (let y = 1; y < this.mapH - 1; y++) {
      walls.create(TILE / 2, y * TILE + TILE / 2, '').setSize(TILE, TILE).setVisible(false).refreshBody();
      walls.create((this.mapW - 1) * TILE + TILE / 2, y * TILE + TILE / 2, '').setSize(TILE, TILE).setVisible(false).refreshBody();
    }
    this.wallsGroup = walls;
  }

  private spawnRemote(p: PlayerState): void {
    if (this.remotePlayers.has(p.playerId)) return;
    const rp = new RemotePlayer(this, p, this.hasLayers);
    this.remotePlayers.set(p.playerId, rp);
  }

  private handleRemoteUpdate(p: PlayerState): void {
    const localId = useGameStore.getState().localPlayerId;
    if (p.playerId === localId) return;
    const existing = this.remotePlayers.get(p.playerId);
    if (existing) existing.setTarget(p);
    else this.spawnRemote(p);
  }

  private handleRemoteRemove(id: string): void {
    const rp = this.remotePlayers.get(id);
    if (rp) {
      rp.destroy();
      this.remotePlayers.delete(id);
    }
  }

  update(): void {
    if (!this.player) return;
    const c = this.cursors;
    const w = this.wasdKeys;
    const input = {
      up: !!(c?.up.isDown || w?.W.isDown),
      down: !!(c?.down.isDown || w?.S.isDown),
      left: !!(c?.left.isDown || w?.A.isDown),
      right: !!(c?.right.isDown || w?.D.isDown),
    };
    this.player.update(input);

    for (const rp of this.remotePlayers.values()) rp.update();

    const x = this.player.sprite.x;
    const y = this.player.sprite.y;
    const dir = this.player.direction;
    const moving = this.player.moving;
    const movedEnough =
      Math.abs(x - this.lastSentX) > 1.5 ||
      Math.abs(y - this.lastSentY) > 1.5 ||
      dir !== this.lastSentDir ||
      moving !== this.lastSentMoving;
    if (movedEnough) {
      this.lastSentX = x;
      this.lastSentY = y;
      this.lastSentDir = dir;
      this.lastSentMoving = moving;
      socketManager.sendMove({ x, y, direction: dir, isMoving: moving });
    }
  }
}
