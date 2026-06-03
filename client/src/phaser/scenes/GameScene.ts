import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import { stepMapZoom } from '../../mapZoom';
import { setFireVolume } from '../../sounds/sounds';
import type { Appearance, EmoteType, InteractiveObject, PlayerState } from '../../types';
import { saveLastPosition } from '../../lastPosition';
import { WorkstationOverlay } from '../WorkstationOverlay';
import { WORKSTATIONS } from '../../workstations';
import { KartOverlay } from '../KartOverlay';
import { MOUNT_DISTANCE, BOOST_DURATION_MS, BOOST_COOLDOWN_MS } from '../../karts';
import { CollisionLayer, type CollisionRect } from '../collision/CollisionLayer';

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
  private collisionLayer?: CollisionLayer;
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
  private unsubConfetti?: () => void;
  private fKey?: Phaser.Input.Keyboard.Key;
  private unsubObject?: () => void;
  private unsubTyping?: () => void;
  private unsubChatForTyping?: () => void;
  private typingTimers = new Map<string, NodeJS.Timeout>();
  private emoteStacks = new Map<string, Phaser.GameObjects.Text[]>();
  private objectVisuals = new Map<string, ObjectVisual>();
  private nearbyObjectId: string | null = null;
  private appliedZoom = 1;
  private appliedAppearance: Appearance | null = null;
  private eKey?: Phaser.Input.Keyboard.Key;
  private lastEDown = false;
  private kartPrompt?: Phaser.GameObjects.Text;
  private zKey?: Phaser.Input.Keyboard.Key;
  private fireplace?: { x: number; y: number; glow: Phaser.GameObjects.Graphics; flame: Phaser.GameObjects.Graphics };
  private screenGlows: Array<{ wsId: string; glow: Phaser.GameObjects.Graphics; near: boolean }> = [];
  private animatedDoors: Array<{ sprite: Phaser.GameObjects.Sprite; cx: number; cy: number; open: boolean }> = [];
  private lastLocalPresence: string | undefined = undefined;
  private workstationOverlay?: WorkstationOverlay;
  private kartOverlay?: KartOverlay;
  private debugMode = false;
  private debugText?: Phaser.GameObjects.Text;
  private debugZoneGfx?: Phaser.GameObjects.Graphics;
  private shiftKey?: Phaser.Input.Keyboard.Key;
  private dKey?: Phaser.Input.Keyboard.Key;
  private lastShiftDCombo = false;
  // F11 — boost state machine (local-only, broadcast via boost_start/_end)
  private boostStartedAt = 0;
  private boostEndedAt = -Infinity;
  private boostGfx?: Phaser.GameObjects.Graphics;
  private boostTrail?: Phaser.GameObjects.Graphics;
  private trailPoints: Array<{ x: number; y: number; t: number }> = [];

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.hasLayers =
      this.textures.exists('layer_body') &&
      this.textures.exists('layer_outfit') &&
      this.textures.exists('layer_hair');

    const tilemapKey = 'map_default';
    const cacheHasMap = this.cache.tilemap.has(tilemapKey);
    const hasTileset = this.textures.exists('tileset_basic');

    if (cacheHasMap && hasTileset) {
      this.buildTilemap();
    } else {
      this.buildFallbackMap();
    }
    this.createScreenGlows();
    this.createGymTreadmills();

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

    if (this.collisionLayer) {
      this.physics.add.collider(this.player.sprite, this.collisionLayer.group);
    } else {
      // Legacy / map fallback procédurale.
      if (this.wallsLayer) this.physics.add.collider(this.player.sprite, this.wallsLayer);
      if (this.furnitureLayer) this.physics.add.collider(this.player.sprite, this.furnitureLayer);
      if (this.wallsGroup) this.physics.add.collider(this.player.sprite, this.wallsGroup);
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

    // Sauvegarde périodique de la position (localStorage) pour réapparaître au
    // même endroit après un refresh, plutôt qu'au spawn d'entrée.
    this.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => {
        if (!this.player) return;
        const slug = useGameStore.getState().currentRoomSlug;
        if (slug) saveLastPosition(slug, this.player.sprite.x, this.player.sprite.y);
      },
    });

    // Mode debug collision : B superpose les rectangles solides en rouge.
    // (C est déjà pris par le chat dans le HUD.)
    this.input.keyboard?.on('keydown-B', () => {
      if (useGameStore.getState().inputFocused) return;
      this.collisionLayer?.toggleDebug();
    });

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
    this.unsubConfetti = socketManager.onConfetti((e) => this.spawnConfetti(e.playerId));
    this.unsubObject = socketManager.onObjectUpdate((obj) => this.refreshObject(obj));

    this.unsubTyping = socketManager.onTypingState((payload) => {
      this.handleTypingState(payload.playerId);
    });

    this.unsubChatForTyping = socketManager.onChatMessage((msg) => {
      this.clearTypingForPlayer(msg.playerId);
    });

    this.eKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.zKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    // F — lance des confettis pour toute la salle (comme dans Gather).
    this.fKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.fKey?.on('down', () => {
      if (useGameStore.getState().inputFocused) return;
      socketManager.sendConfetti();
    });
    this.input.keyboard?.clearCaptures();

    this.kartPrompt = this.add.text(0, 0, '', {
      fontSize: '12px', fontFamily: 'system-ui, sans-serif',
      color: '#ffffff', backgroundColor: '#0f172a', padding: { left: 6, right: 6, top: 2, bottom: 2 },
    }).setOrigin(0.5, 1).setDepth(20).setVisible(false);

    // WorkstationOverlay
    this.workstationOverlay = new WorkstationOverlay(this);
    this.kartOverlay = new KartOverlay(this);

    this.boostGfx = this.add.graphics().setDepth(11);
    this.boostTrail = this.add.graphics().setDepth(7);

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
      // Changement d'avatar en jeu (menu HUD) : applique au Player local en live.
      if (this.player && s.appearance !== this.appliedAppearance) {
        this.appliedAppearance = s.appearance;
        this.player.appearance = s.appearance;
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
      this.unsubConfetti?.();
      this.unsubObject?.();
      this.unsubTyping?.();
      this.unsubChatForTyping?.();
      for (const timer of this.typingTimers.values()) clearTimeout(timer);
      this.typingTimers.clear();
      this.workstationOverlay?.destroy();
      this.kartOverlay?.destroy();
      this.kartPrompt?.destroy();
      this.boostGfx?.destroy();
      this.boostTrail?.destroy();
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

  // Halos bleus "écran allumé" sur les pods LimeZu (procédural, aucun asset).
  // Positions = tuile écran de chaque pod : pod A (30,16), pod B (35,16).
  private createScreenGlows(): void {
    // Écran scintillant sur les 12 pods de l'open space (centres de pod = postes).
    const POD_CENTERS: ReadonlyArray<readonly [number, number]> = [
      [19, 13], [22, 13], [28, 13], [33, 13], [39, 13], [42, 13],
      [19, 17], [22, 17], [28, 17], [33, 17], [39, 17], [42, 17],
    ];
    const SCREENS = POD_CENTERS.map(([cx, cy], i) => ({
      wsId: `poste-${i + 1}`, x: cx * TILE + 16, y: (cy - 1) * TILE + 16,
    }));
    for (const s of SCREENS) {
      const glow = this.add.graphics({ x: s.x, y: s.y });
      glow.fillStyle(0x4aa3ff, 0.5).fillRect(-12, -10, 24, 16);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      glow.setDepth(9.5);
      glow.setAlpha(0.3);
      this.tweens.add({ targets: glow, alpha: 0.55, duration: 900, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      this.screenGlows.push({ wsId: s.wsId, glow, near: false });
    }
  }

  // Tapis de course animés (bande qui défile) posés sur les tapis statiques de
  // la gym. Frame 96x128 ; la machine est à l'offset tuile (+1,+1), donc le
  // sprite (origine 0,0) se place une tuile en haut-à-gauche de la machine.
  private createGymTreadmills(): void {
    if (!this.textures.exists('anim_treadmill')) return;
    if (!this.anims.exists('treadmill_run')) {
      this.anims.create({ key: 'treadmill_run', frames: this.anims.generateFrameNumbers('anim_treadmill', { start: 0, end: 2 }), frameRate: 8, repeat: -1 });
    }
    // machines statiques : tapis aux tuiles (67,18) et (69,18).
    const MACHINES = [{ tc: 67, tr: 18 }, { tc: 69, tr: 18 }];
    for (const mch of MACHINES) {
      const x = (mch.tc - 1) * TILE; // offset machine +1 tuile dans la frame
      const y = (mch.tr - 1) * TILE;
      this.add.sprite(x, y, 'anim_treadmill', 0).setOrigin(0, 0).setDepth(2).play('treadmill_run');
    }
  }

  // Portes animées (battant bois qui s'ouvre/se ferme). Marquées par des objets
  // `door` (points) sur le calque `objects` du .tmj. Sprite 32x64 = 1 tuile de
  // large × 2 de haut, vue de face ("porte sud") : on cale le haut du sprite une
  // tuile au-dessus de la tuile pointée pour que le battant couvre la porte, et
  // on joue l'ouverture quand un joueur (local ou distant) s'approche.
  private createAnimatedDoors(map: Phaser.Tilemaps.Tilemap): void {
    if (!this.textures.exists('anim_door')) return;
    if (!this.anims.exists('door_open')) {
      this.anims.create({ key: 'door_open', frames: this.anims.generateFrameNumbers('anim_door', { start: 0, end: 4 }), frameRate: 16 });
      this.anims.create({ key: 'door_close', frames: this.anims.generateFrameNumbers('anim_door', { start: 4, end: 0 }), frameRate: 16 });
    }
    const layer = map.getObjectLayer('objects');
    if (!layer) return;
    const doors = layer.objects
      .filter((o) => String(o.name ?? '').toLowerCase() === 'door')
      .map((o) => ({ tc: Math.floor(Number(o.x ?? 0) / TILE), tr: Math.floor(Number(o.y ?? 0) / TILE) }));
    const has = (c: number, r: number) => doors.some((d) => d.tc === c && d.tr === r);
    for (const { tc, tr } of doors) {
      // Le sprite est de face ("porte sud") : on ignore les portes sur mur
      // vertical (battant adjacent au-dessus/dessous) qu'il ne sait pas montrer.
      if (has(tc, tr - 1) || has(tc, tr + 1)) continue;
      // Empreinte du battant : 1 tuile large × 2 haut, calée sur le haut de la porte.
      // On efface la porte statique (furniture) ET le mur derrière (walls) pour
      // obtenir une vraie ouverture traversable une fois le battant ouvert.
      for (let r = tr - 1; r <= tr; r++) {
        this.furnitureLayer?.removeTileAt(tc, r);
        this.wallsLayer?.removeTileAt(tc, r);
      }
      const x = tc * TILE;
      const y = (tr - 1) * TILE;
      const sprite = this.add.sprite(x, y, 'anim_door', 0).setOrigin(0, 0).setDepth(2);
      // Double porte : le battant de droite (un voisin existe à sa gauche)
      // s'ouvre en miroir, pour que les deux dégagent le centre.
      if (has(tc - 1, tr)) sprite.setFlipX(true);
      this.animatedDoors.push({ sprite, cx: x + TILE / 2, cy: y + TILE, open: false });
    }
  }

  private buildTilemap(): void {
    const map = this.make.tilemap({ key: 'map_default' });
    this.mapW = map.width;
    this.mapH = map.height;
    // Chaque tileset du .tmj est bindé à la clé image `tileset_<nom>`
    // (convention : voir BootScene). Rétro-compatible : basic -> tileset_basic.
    const tilesets = map.tilesets
      .map((ts) => map.addTilesetImage(ts.name, `tileset_${ts.name}`))
      .filter((t): t is Phaser.Tilemaps.Tileset => t !== null);
    if (tilesets.length === 0) {
      this.buildFallbackMap();
      return;
    }
    for (const layerData of map.layers) {
      const layer = map.createLayer(layerData.name, tilesets, 0, 0);
      if (!layer) continue;
      const name = layerData.name.toLowerCase();
      if (/wall|collide|collision/.test(name)) {
        this.wallsLayer = layer;
      } else if (/furniture/.test(name)) {
        this.furnitureLayer = layer;
      }
    }
    const collObj = map.getObjectLayer('collision');
    if (collObj) {
      const rects: CollisionRect[] = collObj.objects.map((o) => ({
        x: Number(o.x ?? 0),
        y: Number(o.y ?? 0),
        width: Number(o.width ?? 0),
        height: Number(o.height ?? 0),
      }));
      this.collisionLayer = new CollisionLayer(this, rects);
    } else {
      // Legacy : pas de couche dédiée -> collision par propriété de tuile.
      this.wallsLayer?.setCollisionByProperty({ collides: true });
      this.furnitureLayer?.setCollisionByProperty({ collides: true });
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
    this.createAnimatedDoors(map);
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

    // Téléportation vers une cible (ex: "Aller au poste" sur une invitation).
    // On snap directement le sprite à la position, on annule la vélocité, puis
    // on clear la cible — le sendMove plus bas notifiera le serveur.
    // Choix vs. auto-walk: l'absence de pathfinding faisait coincer le perso
    // sur les murs. Téléporter est moins immersif mais 100% fiable.
    const target = useGameStore.getState().autoWalkTarget;
    if (target && this.player) {
      this.player.sprite.setPosition(target.x, target.y);
      const body = this.player.sprite.body as Phaser.Physics.Arcade.Body | null;
      body?.setVelocity(0, 0);
      useGameStore.getState().setAutoWalkTarget(null);
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

    // F11 — render kart sprites. Resolver lit la position depuis les entités
    // Phaser (frame-accurate) et non le store, qui est laggué par le tick serveur.
    this.kartOverlay?.update(storeState.karts, (pid) => {
      if (this.player && pid === storeState.localPlayerId) {
        return {
          x: this.player.sprite.x,
          y: this.player.sprite.y,
          direction: this.player.direction,
          isMoving: this.player.moving,
        };
      }
      const rp = this.remotePlayers.get(pid);
      if (rp) {
        return {
          x: rp.sprite.x,
          y: rp.sprite.y,
          direction: rp.direction,
          isMoving: rp.isMoving,
        };
      }
      return null;
    });

    // F11 — proximité kart (pour prompt "E pour monter")
    if (this.player) {
      const px = this.player.sprite.x;
      const py = this.player.sprite.y;
      let nearest: string | null = null;
      let nearestD = Infinity;
      for (const k of storeState.karts.values()) {
        if (k.driverId !== null) continue;
        const d = Math.hypot(px - k.x, py - k.y);
        if (d <= MOUNT_DISTANCE && d < nearestD) { nearestD = d; nearest = k.id; }
      }
      if (nearest !== storeState.nearbyKartId) storeState.setNearbyKartId(nearest);
    }

    // F11 — push local kart state into Player so it computes speed + applies visual.
    if (this.player) {
      this.player.kartId = storeState.localKartId;
      this.player.boosting = storeState.localBoosting;
    }

    // F11 — E pour monter/descendre (edge-trigger).
    // Priorité: les objets interactifs (nearbyObjectId) ont la priorité sur les karts.
    // Si le joueur est près d'un objet interactif, E reste dédié à cet objet.
    // Si aucun objet interactif n'est proche, E gère le montage/déscente du kart.
    if (!focused) {
      const eDown = this.eKey?.isDown ?? false;
      if (eDown && !this.lastEDown && this.nearbyObjectId === null) {
        const s = useGameStore.getState();
        if (s.localKartId !== null) {
          socketManager.sendKartDismount();
        } else if (s.nearbyKartId !== null) {
          socketManager.sendKartMount(s.nearbyKartId);
        }
      }
      this.lastEDown = eDown;
    } else {
      this.lastEDown = false;
    }

    // F11 — boost lifecycle (Shift while on kart). State machine, broadcasts boost_start/_end.
    {
      const now = this.time.now;
      const s = useGameStore.getState();
      const onKart = s.localKartId !== null;
      const shiftDown = !!this.shiftKey?.isDown;
      const boosting = s.localBoosting;

      if (onKart && shiftDown && !boosting) {
        const sinceEnd = now - this.boostEndedAt;
        if (sinceEnd >= BOOST_COOLDOWN_MS) {
          this.boostStartedAt = now;
          s.setLocalBoosting(true);
          socketManager.sendKartBoostStart();
        }
      }
      if (boosting && (!onKart || now - this.boostStartedAt >= BOOST_DURATION_MS || !shiftDown)) {
        this.boostEndedAt = now;
        s.setLocalBoosting(false);
        socketManager.sendKartBoostEnd();
      }

      // Jauge sous le conducteur (visible uniquement par lui).
      if (this.boostGfx) {
        this.boostGfx.clear();
        if (onKart && this.player) {
          let ratio = 1;
          if (boosting) {
            ratio = Math.max(0, 1 - (now - this.boostStartedAt) / BOOST_DURATION_MS);
          } else {
            ratio = Math.min(1, (now - this.boostEndedAt) / BOOST_COOLDOWN_MS);
            if (this.boostEndedAt === -Infinity) ratio = 1;
          }
          const gx = this.player.sprite.x - 12;
          const gy = this.player.sprite.y + 14;
          this.boostGfx.fillStyle(0x111111, 0.6).fillRect(gx, gy, 24, 3);
          this.boostGfx.fillStyle(0x22c55e, 1).fillRect(gx, gy, Math.round(24 * ratio), 3);
        }
      }

      // Trail orange — visible par tous (local + distants) qui boostent.
      if (this.boostTrail) {
        this.boostTrail.clear();
        const sources: Array<{ x: number; y: number }> = [];
        if (boosting && this.player) sources.push({ x: this.player.sprite.x, y: this.player.sprite.y });
        for (const rp of this.remotePlayers.values()) {
          if (rp.kartId !== null && rp.boosting) sources.push({ x: rp.sprite.x, y: rp.sprite.y });
        }
        for (const src of sources) this.trailPoints.push({ x: src.x, y: src.y, t: now });
        this.trailPoints = this.trailPoints.filter((p) => now - p.t < 200);
        for (const p of this.trailPoints) {
          const age = (now - p.t) / 200;
          const alpha = 0.6 * (1 - age);
          const radius = 5 - age * 3;
          this.boostTrail.fillStyle(0xf97316, alpha).fillCircle(p.x, p.y, radius);
        }
      }
    }

    // F11 — Prompt on-screen "E pour monter / E pour descendre"
    if (this.kartPrompt) {
      const s = useGameStore.getState();
      if (s.localKartId !== null) {
        this.kartPrompt.setText('E pour descendre')
          .setPosition(this.player!.sprite.x, this.player!.sprite.y - 42)
          .setVisible(true);
      } else if (s.nearbyKartId !== null) {
        const k = s.karts.get(s.nearbyKartId);
        if (k) {
          this.kartPrompt.setText('E pour monter')
            .setPosition(k.x, k.y - 18)
            .setVisible(true);
        } else {
          this.kartPrompt.setVisible(false);
        }
      } else {
        this.kartPrompt.setVisible(false);
      }
    }

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
      // Feedback d'approche : l'écran du pod ciblé grossit légèrement.
      for (const sg of this.screenGlows) {
        const shouldBeNear = sg.wsId === nearestId;
        if (shouldBeNear !== sg.near) {
          sg.near = shouldBeNear;
          this.tweens.add({ targets: sg.glow, scale: shouldBeNear ? 1.5 : 1, duration: 200, ease: 'Quad.easeOut' });
        }
      }
    }

    // Portes animées : s'ouvrent dès qu'un joueur (local ou distant) est à portée.
    if (this.animatedDoors.length) {
      const DOOR_RADIUS = 56; // px
      const positions: Array<{ x: number; y: number }> = [];
      if (this.player) positions.push({ x: this.player.sprite.x, y: this.player.sprite.y });
      for (const rp of this.remotePlayers.values()) positions.push({ x: rp.sprite.x, y: rp.sprite.y });
      for (const d of this.animatedDoors) {
        const near = positions.some((p) => Math.abs(p.x - d.cx) <= DOOR_RADIUS && Math.abs(p.y - d.cy) <= DOOR_RADIUS);
        if (near !== d.open) {
          d.open = near;
          d.sprite.play(near ? 'door_open' : 'door_close');
        }
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

  // Confettis (touche F) — burst de particules colorées centré sur le joueur,
  // déclenché pour tout le monde via l'événement réseau 'confetti'.
  private spawnConfetti(playerId: string): void {
    const pos = this.getPlayerSprite(playerId);
    if (!pos) return;
    if (!this.textures.exists('confetti_px')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 6, 10);
      g.generateTexture('confetti_px', 6, 10);
      g.destroy();
    }
    const colors = [
      0xef4444, 0xf97316, 0xfacc15, 0x22c55e,
      0x3b82f6, 0xa855f7, 0xec4899, 0x06b6d4,
    ];
    const emitter = this.add.particles(pos.x, pos.y - 36, 'confetti_px', {
      lifespan: 1200,
      speed: { min: 140, max: 340 },
      angle: { min: 180, max: 360 }, // hémisphère haut (gauche -> haut -> droite)
      gravityY: 700,
      scale: { start: 1, end: 0.6 },
      rotate: { min: 0, max: 360 },
      tint: colors,
      emitting: false,
    });
    emitter.setDepth(30);
    emitter.explode(70);
    this.time.delayedCall(1500, () => emitter.destroy());
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
