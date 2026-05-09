import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import type { PlayerState } from '../../types';

const TILE = 32;
const MAP_W = 50;
const MAP_H = 40;

export class GameScene extends Phaser.Scene {
  private player?: Player;
  private remotePlayers = new Map<string, RemotePlayer>();
  private wasdKeys?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  private wallsGroup?: Phaser.Physics.Arcade.StaticGroup;
  private hasAvatars = false;
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
    this.hasAvatars = this.textures.exists('avatars');

    const tilemapKey = 'map_default';
    const cacheHasMap = this.cache.tilemap.has(tilemapKey);
    const hasTileset = this.textures.exists('tileset_basic');

    if (cacheHasMap && hasTileset) {
      this.buildTilemap();
    } else {
      this.buildFallbackMap();
    }

    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    const store = useGameStore.getState();
    const localId = store.localPlayerId;
    const localState = localId ? store.players.get(localId) : undefined;
    const startX = localState?.x ?? worldW / 2;
    const startY = localState?.y ?? worldH / 2;

    this.player = new Player(
      this,
      startX,
      startY,
      store.avatar,
      store.name || 'Vous',
      this.hasAvatars,
    );

    if (this.wallsLayer) {
      this.physics.add.collider(this.player.sprite, this.wallsLayer);
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
    const tilesetName = map.tilesets[0]?.name ?? 'basic';
    const tileset = map.addTilesetImage(tilesetName, 'tileset_basic');
    if (!tileset) {
      this.buildFallbackMap();
      return;
    }
    for (const layerData of map.layers) {
      const layer = map.createLayer(layerData.name, tileset, 0, 0);
      if (!layer) continue;
      const isWalls = /wall|collide|collision/i.test(layerData.name);
      if (isWalls) {
        layer.setCollisionByExclusion([-1, 0]);
        this.wallsLayer = layer;
      }
    }
  }

  private buildFallbackMap(): void {
    const g = this.add.graphics();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const isBorder = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
        const color = isBorder ? 0x334155 : (x + y) % 2 === 0 ? 0x1f8a4c : 0x22a55a;
        g.fillStyle(color, 1);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    g.lineStyle(1, 0x000000, 0.06);
    for (let x = 0; x <= MAP_W; x++) {
      g.lineBetween(x * TILE, 0, x * TILE, MAP_H * TILE);
    }
    for (let y = 0; y <= MAP_H; y++) {
      g.lineBetween(0, y * TILE, MAP_W * TILE, y * TILE);
    }

    const walls = this.physics.add.staticGroup();
    for (let x = 0; x < MAP_W; x++) {
      walls.create(x * TILE + TILE / 2, TILE / 2, '').setSize(TILE, TILE).setVisible(false).refreshBody();
      walls.create(x * TILE + TILE / 2, (MAP_H - 1) * TILE + TILE / 2, '').setSize(TILE, TILE).setVisible(false).refreshBody();
    }
    for (let y = 1; y < MAP_H - 1; y++) {
      walls.create(TILE / 2, y * TILE + TILE / 2, '').setSize(TILE, TILE).setVisible(false).refreshBody();
      walls.create((MAP_W - 1) * TILE + TILE / 2, y * TILE + TILE / 2, '').setSize(TILE, TILE).setVisible(false).refreshBody();
    }
    this.wallsGroup = walls;
  }

  private spawnRemote(p: PlayerState): void {
    if (this.remotePlayers.has(p.id)) return;
    const rp = new RemotePlayer(this, p, this.hasAvatars);
    this.remotePlayers.set(p.id, rp);
  }

  private handleRemoteUpdate(p: PlayerState): void {
    const localId = useGameStore.getState().localPlayerId;
    if (p.id === localId) return;
    const existing = this.remotePlayers.get(p.id);
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
      socketManager.sendMove({ x, y, direction: dir, moving });
    }
  }
}
