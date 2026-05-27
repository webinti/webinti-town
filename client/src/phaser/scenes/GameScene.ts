import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import { stepMapZoom } from '../../mapZoom';
import { setFireVolume } from '../../sounds/sounds';
import type { EmoteType, InteractiveObject, PlayerState } from '../../types';
import { WorkstationOverlay } from '../WorkstationOverlay';
import { WORKSTATIONS } from '../../workstations';

// Fireplace anchor in pixel coords — tile (x, y) center is (x*32+16, y*32+16).
// Tile (1, 30): against the west wall of the meeting room.
// The fireplace faces east — opening pointing toward the meeting table.
const FIREPLACE_X = 1 * 32 + 16;
const FIREPLACE_Y = 30 * 32 + 16;
const FIRE_AUDIBLE_RADIUS = 6 * 32;

const EMOTE_EMOJI: Record<EmoteType, string> = {
  wave: '\u{1F44B}',
  thumbsup: '\u{1F44D}',
  laugh: '\u{1F602}',
  heart: '❤️',
  question: '❓',
  exclaim: '❗',
};

interface ObjectVisual {
  obj: InteractiveObject;
  icon: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
  liveLabel: Phaser.GameObjects.Text;
}

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
  // Physics group holding the remote players' (immovable) bodies, so a single
  // collider against the local player handles all of them. Ghost mode is
  // honored via the processCallback registered in create().
  private remoteBodiesGroup?: Phaser.Physics.Arcade.Group;
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
  private unsubEmote?: () => void;
  private unsubObject?: () => void;
  private unsubTyping?: () => void;
  private unsubChatForTyping?: () => void;
  private typingTimers = new Map<string, NodeJS.Timeout>();
  private emoteStacks = new Map<string, Phaser.GameObjects.Text[]>();
  private objectVisuals = new Map<string, ObjectVisual>();
  private nearbyObjectId: string | null = null;
  private appliedZoom = 1;
  private eKey?: Phaser.Input.Keyboard.Key;
  private zKey?: Phaser.Input.Keyboard.Key;
  private fireplace?: { x: number; y: number; glow: Phaser.GameObjects.Graphics; flame: Phaser.GameObjects.Graphics };
  private lastLocalPresence: string | undefined = undefined;
  private workstationOverlay?: WorkstationOverlay;
  private debugMode = false;
  private debugText?: Phaser.GameObjects.Text;
  private debugZoneGfx?: Phaser.GameObjects.Graphics;
  private shiftKey?: Phaser.Input.Keyboard.Key;
  private dKey?: Phaser.Input.Keyboard.Key;
  private lastShiftDCombo = false;

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

    this.buildFireplace();

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

    // Player-vs-player collisions. RemotePlayer bodies are added to this
    // group when they spawn. The processCallback short-circuits the
    // collision when either side is in ghost mode, which is the whole
    // point of ghost mode existing.
    this.remoteBodiesGroup = this.physics.add.group();
    this.physics.add.collider(
      this.player.sprite,
      this.remoteBodiesGroup,
      undefined,
      (_localObj, remoteObj) => {
        if (this.player?.isGhost) return false;
        const sprite = remoteObj as Phaser.GameObjects.GameObject;
        const rp = sprite.getData('remote') as RemotePlayer | undefined;
        if (rp?.isGhost) return false;
        return true;
      },
      this,
    );

    this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);
    this.appliedZoom = store.mapZoom;
    this.cameras.main.setZoom(this.appliedZoom);

    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _over: unknown,
        _dx: number,
        dy: number,
      ) => {
        const cur = useGameStore.getState().mapZoom;
        const step = dy < 0 ? 0.1 : -0.1;
        useGameStore.getState().setMapZoom(cur + step);
      },
    );

    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _objects: unknown,
        _dx: number,
        dy: number,
      ) => {
        const store = useGameStore.getState();
        const dir: 1 | -1 = dy > 0 ? -1 : 1; // wheel down -> zoom out
        store.setMapZoom(stepMapZoom(store.mapZoom, dir, 0.1));
      },
    );

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
    this.unsubEmote = socketManager.onEmote((e) => this.handleEmote(e.playerId, e.emoteType));
    this.unsubObject = socketManager.onObjectUpdate((obj) => this.refreshObject(obj));

    this.unsubTyping = socketManager.onTypingState((payload) => {
      this.handleTypingState(payload.playerId);
    });

    this.unsubChatForTyping = socketManager.onChatMessage((msg) => {
      this.clearTypingForPlayer(msg.playerId);
    });

    this.eKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.zKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.input.keyboard?.clearCaptures();

    // WorkstationOverlay
    this.workstationOverlay = new WorkstationOverlay(this);

    // Debug Shift+D
    this.shiftKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.dKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.eKey?.on('down', () => {
      const store = useGameStore.getState();
      if (store.inputFocused) return;
      if (!this.nearbyObjectId) return;
      const obj = store.interactiveObjects.find((o) => o.id === this.nearbyObjectId);
      if (obj && obj.type === 'whiteboard') {
        store.setOpenWhiteboard(obj.id);
        return;
      }
      if (obj && obj.type === 'note') {
        store.setOpenNote(obj.id);
        return;
      }
      if (obj && obj.type === 'link') {
        store.setOpenLink(obj.id);
        return;
      }
      if (obj && obj.type === 'kanban') {
        store.setOpenKanban(obj.id);
        return;
      }
      socketManager.interactObject(this.nearbyObjectId);
    });

    for (const obj of useGameStore.getState().interactiveObjects) {
      this.refreshObject(obj);
    }

    this.unsubStore = useGameStore.subscribe((s) => {
      if (s.mapZoom !== this.appliedZoom) {
        this.appliedZoom = s.mapZoom;
        this.cameras.main.setZoom(this.appliedZoom);
      }
      const lid = s.localPlayerId;
      const localState = lid ? s.players.get(lid) : undefined;
      if (this.player && localState) {
        this.player.setGhost(localState.isGhost === true);
      }
      for (const [id, p] of s.players) {
        if (id === lid) continue;
        const existing = this.remotePlayers.get(id);
        if (existing) {
          existing.setTarget(p);
          existing.setPresence(p.presence);
        } else {
          this.spawnRemote(p);
        }
      }
      for (const id of this.remotePlayers.keys()) {
        if (!s.players.has(id)) this.handleRemoteRemove(id);
      }
      for (const obj of s.interactiveObjects) this.refreshObject(obj);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubUpdate?.();
      this.unsubRemove?.();
      this.unsubStore?.();
      this.unsubEmote?.();
      this.unsubObject?.();
      this.unsubTyping?.();
      this.unsubChatForTyping?.();
      for (const timer of this.typingTimers.values()) clearTimeout(timer);
      this.typingTimers.clear();
      this.workstationOverlay?.destroy();
      this.debugText?.destroy();
      this.debugZoneGfx?.destroy();
    });
  }

  private buildFireplace(): void {
    const x = FIREPLACE_X;
    const y = FIREPLACE_Y;

    // East-facing fireplace built into a west wall.
    // Local origin (0, 0) = center of the opening (where the flame anchors on the log).
    //
    //   -16  ┌─┐                            stone backing (against wall)
    //        │█│
    //        │█│ ┌────────────────┐        opening extending east
    //        │█│ │ ░░░░░░░░░░░░░░░│        hearth interior
    //        │█│ │ ░░░░ flame ░░░░│
    //        │█│ │ ──── log ──────│
    //   +16  └─┘ └────────────────┘
    //
    //   x = -18 to -10 : stone backing (8 wide)
    //   x = -10 to +18 : opening (28 wide)
    //   y = -14 to +14 : full height (28 tall)
    //   log: x = -8 to +16, y = +8 to +14
    //   flame anchored at local (4, 8) — center of log, sticking up and slightly east
    const container = this.add.container(x, y);
    container.setDepth(7);

    const base = this.add.graphics();
    // Stone backing (vertical pillar against the wall)
    base.fillStyle(0x9ca3af, 1).fillRect(-18, -16, 8, 32);
    base.lineStyle(1, 0x4b5563, 1).strokeRect(-18, -16, 8, 32);
    // Top trim of the opening (lintel)
    base.fillStyle(0x6b7280, 1).fillRect(-10, -16, 28, 4);
    base.lineStyle(1, 0x4b5563, 1).strokeRect(-10, -16, 28, 4);
    // Bottom trim (floor edge of opening)
    base.fillStyle(0x6b7280, 1).fillRect(-10, 12, 28, 4);
    base.lineStyle(1, 0x4b5563, 1).strokeRect(-10, 12, 28, 4);
    // Hearth interior (dark) — opens to the east
    base.fillStyle(0x0f172a, 1).fillRect(-10, -12, 28, 24);
    base.lineStyle(1, 0x000000, 1).strokeRect(-10, -12, 28, 24);
    // Log at the bottom of the hearth (horizontal)
    base.fillStyle(0x57321a, 1).fillRect(-8, 6, 24, 6);
    base.fillStyle(0x7a4625, 1).fillRect(-8, 6, 24, 2);
    container.add(base);

    // Glow contained inside the hearth, slightly east-biased
    const glow = this.add.graphics();
    glow.fillStyle(0xffb35a, 0.35).fillRect(-8, -10, 24, 18);
    glow.fillStyle(0xff8a3a, 0.55).fillRect(-6, -4, 22, 12);
    glow.setAlpha(0.85);
    container.add(glow);

    // Flame — anchored on the log, slightly east of center for "facing east" feel
    const flame = this.add.graphics();
    flame.setPosition(4, 8);
    flame.fillStyle(0xffe27a, 1).fillTriangle(0, -16, -6, 0, 6, 0);
    flame.fillStyle(0xff8a1a, 1).fillTriangle(0, -11, -4, 0, 4, 0);
    flame.fillStyle(0xff3b1a, 1).fillTriangle(0, -7, -2, 0, 2, 0);
    container.add(flame);

    this.tweens.add({
      targets: flame,
      scaleY: 0.78,
      duration: 320,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
    this.tweens.add({
      targets: glow,
      alpha: 0.55,
      duration: 480,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    this.fireplace = { x, y, glow, flame };
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
    const objLayer = map.getObjectLayer('objects');
    if (objLayer) {
      for (const obj of objLayer.objects as Array<Record<string, unknown>>) {
        const kind = String(obj.type ?? obj.class ?? '').toLowerCase();
        if (kind !== 'sign') continue;
        let text: string = '';
        const props = obj.properties;
        if (Array.isArray(props)) {
          const found = props.find((p: { name: string }) => p.name === 'text') as
            | { value?: unknown }
            | undefined;
          if (found?.value != null) text = String(found.value);
        } else if (props && typeof props === 'object') {
          const v = (props as Record<string, unknown>).text;
          if (v != null) text = String(v);
        }
        if (!text) text = String(obj.name ?? '');
        if (!text) continue;
        const x = Number(obj.x ?? 0) + Number(obj.width ?? 0) / 2;
        const y = Number(obj.y ?? 0) + Number(obj.height ?? 0) / 2;
        this.add
          .text(x, y, text, {
            fontSize: '14px',
            fontFamily: 'system-ui, sans-serif',
            color: '#ffffff',
            backgroundColor: '#0f172a',
            padding: { left: 6, right: 6, top: 3, bottom: 3 },
          })
          .setOrigin(0.5, 0.5)
          .setDepth(20);
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
    if (this.remoteBodiesGroup) rp.enableCollisionBody(this.remoteBodiesGroup);
  }

  private handleRemoteUpdate(p: PlayerState): void {
    const localId = useGameStore.getState().localPlayerId;
    if (p.playerId === localId) return;
    const existing = this.remotePlayers.get(p.playerId);
    if (existing) {
      existing.setTarget(p);
      existing.setPresence(p.presence);
    } else {
      this.spawnRemote(p);
    }
  }

  private handleRemoteRemove(id: string): void {
    const rp = this.remotePlayers.get(id);
    if (rp) {
      rp.destroy();
      this.remotePlayers.delete(id);
    }
    // Si ce joueur avait une bulle active, annuler son timer.
    const timer = this.typingTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(id);
    }
  }

  private handleTypingState(playerId: string): void {
    const rp = this.remotePlayers.get(playerId);
    if (!rp) return;
    // Afficher la bulle immédiatement.
    rp.setTyping(true);
    // Réinitialiser le timer 2 s (annuler l'ancien si présent).
    const existing = this.typingTimers.get(playerId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.typingTimers.delete(playerId);
      const r = this.remotePlayers.get(playerId);
      if (r) r.setTyping(false);
    }, 2000);
    this.typingTimers.set(playerId, timer);
  }

  private clearTypingForPlayer(playerId: string): void {
    const existing = this.typingTimers.get(playerId);
    if (existing) {
      clearTimeout(existing);
      this.typingTimers.delete(playerId);
    }
    const rp = this.remotePlayers.get(playerId);
    if (rp) rp.setTyping(false);
  }

  update(): void {
    if (!this.player) return;
    const desiredZoom = useGameStore.getState().mapZoom;
    if (desiredZoom !== this.appliedZoom) {
      this.appliedZoom = desiredZoom;
      this.cameras.main.setZoom(desiredZoom);
    }
    if (this.fireplace) {
      const dx = this.player.sprite.x - this.fireplace.x;
      const dy = this.player.sprite.y - this.fireplace.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const v = Math.max(0, Math.min(1, 1 - d / FIRE_AUDIBLE_RADIUS));
      setFireVolume(v * 0.7);
    }
    const focused = useGameStore.getState().inputFocused;
    const c = this.cursors;
    const w = this.wasdKeys;
    let input = focused
      ? { up: false, down: false, left: false, right: false, dance: false }
      : {
          up: !!(c?.up.isDown || w?.W.isDown),
          down: !!(c?.down.isDown || w?.S.isDown),
          left: !!(c?.left.isDown || w?.A.isDown),
          right: !!(c?.right.isDown || w?.D.isDown),
          dance: !!this.zKey?.isDown,
        };

    // Auto-walk : si une cible est définie (ex: "Aller au poste"), on force
    // les directions vers (target.x, target.y). Une saisie manuelle (n'importe
    // quelle flèche) annule immédiatement l'auto-walk. La physique gère les
    // collisions (le joueur s'arrête sur un mur), et un timeout de 15s force
    // le clear si jamais on est bloqué.
    const target = useGameStore.getState().autoWalkTarget;
    if (target && this.player) {
      const manualOverride = input.up || input.down || input.left || input.right;
      const dx = target.x - this.player.sprite.x;
      const dy = target.y - this.player.sprite.y;
      const dist = Math.hypot(dx, dy);
      const timeout = Date.now() - target.startedAt > 15_000;
      if (manualOverride || dist < 24 || timeout) {
        useGameStore.getState().setAutoWalkTarget(null);
      } else {
        const THRESH = 6;   // ignore les micro-déplacements pour éviter le jitter
        input = {
          up: dy < -THRESH,
          down: dy > THRESH,
          left: dx < -THRESH,
          right: dx > THRESH,
          dance: false,
        };
      }
    }

    this.player.update(input);

    for (const rp of this.remotePlayers.values()) rp.update();

    this.updateEmoteStacks();
    this.updateObjectProximity();

    const { localPresence } = useGameStore.getState();
    if (localPresence !== this.lastLocalPresence) {
      this.lastLocalPresence = localPresence;
      this.player?.setPresence(localPresence);
    }

    // WorkstationOverlay — redessine les contours à chaque frame.
    const storeState = useGameStore.getState();
    const localId = storeState.localPlayerId;
    this.workstationOverlay?.update(storeState.workstations, localId);

    // Détection proximité poste de travail (pour WorkstationPanel).
    if (this.player) {
      const px = this.player.sprite.x;
      const py = this.player.sprite.y;
      const PROXIMITY_RADIUS = 48; // px
      let nearestId: string | null = null;
      let nearestDist = Infinity;
      for (const def of WORKSTATIONS) {
        // Centre du poste
        const cx = (def.minX + def.maxX) / 2;
        const cy = (def.minY + def.maxY) / 2;
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Ou être à l'intérieur : vérifier si px,py est dans la zone (+ buffer)
        const inZone =
          px >= def.minX - PROXIMITY_RADIUS &&
          px <= def.maxX + PROXIMITY_RADIUS &&
          py >= def.minY - PROXIMITY_RADIUS &&
          py <= def.maxY + PROXIMITY_RADIUS;
        if (inZone && dist < nearestDist) {
          nearestDist = dist;
          nearestId = def.id;
        }
      }
      if (nearestId !== storeState.nearbyWorkstationId) {
        storeState.setNearbyWorkstationId(nearestId);
      }
    }

    // Debug Shift+D — toggle affichage coords + zones
    const shiftDown = this.shiftKey?.isDown ?? false;
    const dDown = !!this.dKey?.isDown;
    const combo = shiftDown && dDown;
    if (combo && !this.lastShiftDCombo) {
      this.debugMode = !this.debugMode;
      if (!this.debugMode) {
        this.debugText?.setVisible(false);
        this.debugZoneGfx?.clear();
      }
    }
    this.lastShiftDCombo = combo;

    if (this.debugMode && this.player) {
      const px = Math.round(this.player.sprite.x);
      const py = Math.round(this.player.sprite.y);
      const tx = Math.floor(px / 32);
      const ty = Math.floor(py / 32);
      const workstationId = storeState.players.get(localId ?? '')?.workstationId ?? 'null';
      const label = `pixel:(${px},${py})  tile:(${tx},${ty})  ws:${workstationId}`;

      if (!this.debugText) {
        this.debugText = this.add.text(8, 8, '', {
          fontSize: '12px', fontFamily: 'monospace',
          color: '#ffffff', backgroundColor: '#000000aa',
          padding: { left: 4, right: 4, top: 2, bottom: 2 },
        }).setScrollFactor(0).setDepth(50);
      }
      this.debugText.setText(label).setVisible(true);

      // Redessiner les zones de debug (plus opaque que l'overlay normal)
      if (!this.debugZoneGfx) {
        this.debugZoneGfx = this.add.graphics().setDepth(49);
      }
      this.debugZoneGfx.clear();
      for (const def of WORKSTATIONS) {
        this.debugZoneGfx.lineStyle(1, 0xffd700, 0.9);
        this.debugZoneGfx.strokeRect(def.minX, def.minY, def.maxX - def.minX, def.maxY - def.minY);
        this.debugZoneGfx.fillStyle(0xffd700, 0.15);
        this.debugZoneGfx.fillRect(def.minX, def.minY, def.maxX - def.minX, def.maxY - def.minY);
        // Label id
        this.debugZoneGfx.fillStyle(0x000000, 0);   // reset fill pour le texte séparé
      }
    }

    // Mise à jour des bulles 💬 — affichée UNIQUEMENT quand le joueur parle
    // ET qu'il y a au moins une autre personne dans le même poste (sinon
    // c'est inutile de signaler une conversation à soi-même).
    const speakingIds = storeState.speakingPlayerIds;
    // Compte le nombre d'occupants par workstationId.
    const occupancy = new Map<string, number>();
    for (const p of storeState.players.values()) {
      if (p.workstationId) {
        occupancy.set(p.workstationId, (occupancy.get(p.workstationId) ?? 0) + 1);
      }
    }
    const showBubbleFor = (wsId: string | null | undefined, isSpeaking: boolean): boolean => {
      if (!isSpeaking) return false;
      if (!wsId) return false;
      return (occupancy.get(wsId) ?? 0) >= 2;
    };
    for (const [id, rp] of this.remotePlayers) {
      const playerState = storeState.players.get(id);
      const wsId = playerState?.workstationId ?? null;
      const isSpeaking = speakingIds.has(id);
      const show = showBubbleFor(wsId, isSpeaking);
      rp.setSpeaking(show, isSpeaking);
    }
    if (this.player && localId) {
      const localState = storeState.players.get(localId);
      const wsId = localState?.workstationId ?? null;
      const isSpeaking = speakingIds.has(localId);
      const show = showBubbleFor(wsId, isSpeaking);
      this.player.setSpeaking(show, isSpeaking);
    }

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

  private getPlayerSprite(playerId: string): { x: number; y: number } | null {
    const localId = useGameStore.getState().localPlayerId;
    if (playerId === localId && this.player) {
      return { x: this.player.sprite.x, y: this.player.sprite.y };
    }
    const rp = this.remotePlayers.get(playerId);
    if (rp) {
      const anyRp = rp as unknown as { sprite?: { x: number; y: number } };
      if (anyRp.sprite) return { x: anyRp.sprite.x, y: anyRp.sprite.y };
    }
    const p = useGameStore.getState().players.get(playerId);
    if (p) return { x: p.x, y: p.y };
    return null;
  }

  private handleEmote(playerId: string, emoteType: EmoteType): void {
    const emoji = EMOTE_EMOJI[emoteType];
    if (!emoji) return;
    const text = this.add.text(0, 0, emoji, {
      fontSize: '24px',
      fontFamily: 'system-ui, sans-serif',
    });
    text.setOrigin(0.5, 1).setDepth(12).setScale(0.2);

    const stack = this.emoteStacks.get(playerId) ?? [];
    stack.push(text);
    this.emoteStacks.set(playerId, stack);

    this.tweens.add({
      targets: text,
      scale: 1,
      duration: 220,
      ease: 'Back.Out',
    });
    this.tweens.add({
      targets: text,
      alpha: 0,
      duration: 400,
      delay: 2100,
      onComplete: () => {
        text.destroy();
        const arr = this.emoteStacks.get(playerId);
        if (arr) {
          const idx = arr.indexOf(text);
          if (idx >= 0) arr.splice(idx, 1);
          if (arr.length === 0) this.emoteStacks.delete(playerId);
        }
      },
    });
  }

  private updateEmoteStacks(): void {
    for (const [playerId, stack] of this.emoteStacks) {
      const pos = this.getPlayerSprite(playerId);
      if (!pos) continue;
      let yOffset = -42;
      for (let i = stack.length - 1; i >= 0; i--) {
        const t = stack[i]!;
        t.x = pos.x;
        t.y = pos.y + yOffset;
        yOffset -= 26;
      }
    }
  }

  private refreshObject(obj: InteractiveObject): void {
    const cx = obj.x + 16;
    const cy = obj.y + 16;
    let visual = this.objectVisuals.get(obj.id);
    if (!visual) {
      const emoji =
        obj.type === 'screen'
          ? '\u{1F4FA}'
          : obj.type === 'whiteboard'
            ? '\u{1F3A8}'
            : obj.type === 'note'
              ? '\u{1F4DD}'
              : obj.type === 'kanban'
                ? '\u{1F4CB}'
                : '\u{1F517}';
      const hintText =
        obj.type === 'kanban'
          ? "Appuyer sur E — Tableau d'idées"
          : '[E] Interagir';
      const icon = this.add
        .text(cx, cy, emoji, { fontSize: '28px', fontFamily: 'system-ui, sans-serif' })
        .setOrigin(0.5, 0.5)
        .setDepth(8);
      const hint = this.add
        .text(cx, cy - 28, hintText, {
          fontSize: '12px',
          fontFamily: 'system-ui, sans-serif',
          color: '#ffffff',
          backgroundColor: '#1e293b',
          padding: { left: 4, right: 4, top: 2, bottom: 2 },
        })
        .setOrigin(0.5, 1)
        .setDepth(11);
      hint.setVisible(false);
      const liveLabel = this.add
        .text(cx, cy - 44, '', {
          fontSize: '11px',
          fontFamily: 'system-ui, sans-serif',
          color: '#ffffff',
          backgroundColor: '#dc2626',
          padding: { left: 4, right: 4, top: 1, bottom: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(11);
      liveLabel.setVisible(false);
      visual = { obj, icon, hint, liveLabel };
      this.objectVisuals.set(obj.id, visual);
    }
    visual.obj = obj;

    if (obj.type === 'screen') {
      const sharerId = obj.data.sharedByPlayerId;
      if (sharerId) {
        const sharer = useGameStore.getState().players.get(sharerId);
        const name = sharer?.name ?? '...';
        visual.liveLabel.setText(`LIVE · ${name}`);
        visual.liveLabel.setVisible(true);
        visual.icon.setTint(0xff5555);
      } else {
        visual.liveLabel.setVisible(false);
        visual.icon.clearTint();
      }
    }
  }

  private updateObjectProximity(): void {
    if (!this.player) return;
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let nearestId: string | null = null;
    let nearestDistSq = 32 * 32;
    const t = this.time.now;
    for (const [id, v] of this.objectVisuals) {
      const dx = v.obj.x + 16 - px;
      const dy = v.obj.y + 16 - py;
      const dsq = dx * dx + dy * dy;
      const inRange = dsq <= 32 * 32;
      v.hint.setVisible(inRange);
      if (inRange) {
        const pulse = 1 + Math.sin(t / 200) * 0.08;
        v.icon.setScale(pulse);
        if (dsq < nearestDistSq) {
          nearestDistSq = dsq;
          nearestId = id;
        }
      } else {
        v.icon.setScale(1);
      }
    }
    this.nearbyObjectId = nearestId;
  }
}
