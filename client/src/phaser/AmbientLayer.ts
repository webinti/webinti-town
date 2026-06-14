import Phaser from 'phaser';
import { Npc } from './Npc';
import type { Appearance } from '../types';
import { playMeow } from '../sounds/sounds';

// Vie de la map : flammes de cheminée, papillons, bulle d'accueil de la secrétaire
// (vague 1) + chat qui se prélasse près de la cheminée et PNJ d'ambiance (vague 2).
// Positions en px monde, faciles à ajuster ci-dessous.

const FIRE_SPOTS = [{ x: 1412, y: 730 }];            // cheminée
// Vapeur sur les 2 machines à café du coin pause (comptoirs sombres avec tasses).
const STEAM_SPOTS: Array<{ x: number; y: number }> = [
  { x: 478, y: 740 }, // machine à café gauche
  { x: 768, y: 740 }, // machine à café droite
];
const GREETERS = [
  // Secrétaire IA « Marie » : la bulle invite à lui parler dans le chat de
  // proximité. Rayon < proximité IA (160px) pour que l'indice n'apparaisse que
  // là où elle répond réellement.
  {
    x: 48,
    y: 560,
    text: 'Bonjour, je suis Marie 👋\nParlez-moi dans le chat « Proximité » 💬',
    radius: 150,
    originX: 0, // ancrée à gauche : Marie est contre le mur, la bulle s'étend vers la pièce
  },
];
const BUTTERFLY_ZONE = { x0: 60, y0: 30, x1: 1860, y1: 300 };
const N_BUTTERFLIES = 7;
const BUTTERFLY_COLORS = [0xfacc15, 0xf472b6, 0x60a5fa, 0xfb923c, 0xa78bfa];

// Chat qui se balade dans le coin cheminée (zone de sol dégagée). Miaule quand
// un joueur est à proximité.
const CAT_ZONE = { x0: 1240, y0: 778, x1: 1520, y1: 852 };
const CAT_SPEED = 20;          // px/s (chat tranquille)
const CAT_MEOW_RANGE = 180;    // px : miaule si un joueur est plus près que ça
// La planche LimeZu a un cycle de 3 par "vraie" frame : i%3==1 = chat complet
// (32×30), i%3==2 = sliver (6px), i%3==0 = demi-chat. On ne garde QUE les chats
// complets (i%3==1), sinon ça clignote.
const CAT_FRAMES = Array.from({ length: 36 }, (_, i) => i).filter((i) => i % 3 === 1);
// PNJ d'ambiance : { x, y, appearance, dir, bob:[amp,durMs] }
const NPCS: Array<{
  x: number; y: number; appearance: Appearance;
  dir: 'down' | 'up' | 'left' | 'right'; bob: [number, number];
}> = [
  // Personne qui tape au clavier dans l'open space (face à l'écran = haut)
  { x: 640, y: 470, appearance: { skin: 3, outfit: 5, hairStyle: 2, hairColor: 0 }, dir: 'up', bob: [2, 240] },
  // Sportif sur le tapis de la gym
  { x: 2200, y: 470, appearance: { skin: 5, outfit: 8, hairStyle: 0, hairColor: 2 }, dir: 'down', bob: [5, 300] },
];

interface Butterfly {
  s: Phaser.GameObjects.Sprite;
  tx: number; ty: number;          // cible courante
  speed: number;
  phase: number;
}

interface Greeter {
  bubble: Phaser.GameObjects.Text;
  x: number; y: number; radius: number;
  shown: boolean;
}

export class AmbientLayer {
  private readonly scene: Phaser.Scene;
  private readonly objs: Phaser.GameObjects.GameObject[] = [];
  private butterflies: Butterfly[] = [];
  private greeters: Greeter[] = [];
  private npcs: Npc[] = [];
  private cat?: Phaser.GameObjects.Sprite;
  private catTx = 0;
  private catTy = 0;
  private catPauseUntil = 0;
  private catLastMeow = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.ensureTextures();
    this.createFire();
    this.createSteam();
    this.createButterflies();
    this.createGreeters();
    this.createCat();
    this.createNpcs();
  }

  private createCat(): void {
    if (!this.scene.textures.exists('anim_cat')) return;
    if (!this.scene.anims.exists('cat_idle')) {
      this.scene.anims.create({
        key: 'cat_idle',
        // Exclut les frames vides (sinon clignotement).
        frames: this.scene.anims.generateFrameNumbers('anim_cat', { frames: CAT_FRAMES }),
        frameRate: 7,
        repeat: -1,
      });
    }
    const x = (CAT_ZONE.x0 + CAT_ZONE.x1) / 2;
    const y = (CAT_ZONE.y0 + CAT_ZONE.y1) / 2;
    this.cat = this.scene.add.sprite(x, y, 'anim_cat', CAT_FRAMES[0]).setDepth(6).play('cat_idle');
    this.catTx = x;
    this.catTy = y;
    this.objs.push(this.cat);
  }

  private updateCat(localX: number, localY: number, dt: number, now: number): void {
    const cat = this.cat;
    if (!cat) return;
    // Déplacement (avec pauses).
    if (now >= this.catPauseUntil) {
      const dx = this.catTx - cat.x;
      const dy = this.catTy - cat.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        // Arrivé : pause puis nouvelle cible au hasard dans la zone.
        this.catPauseUntil = now + 1500 + Math.random() * 3500;
        this.catTx = CAT_ZONE.x0 + Math.random() * (CAT_ZONE.x1 - CAT_ZONE.x0);
        this.catTy = CAT_ZONE.y0 + Math.random() * (CAT_ZONE.y1 - CAT_ZONE.y0);
      } else {
        const step = (CAT_SPEED * dt) / 1000;
        cat.x += (dx / d) * step;
        cat.y += (dy / d) * step;
        cat.setFlipX(dx < 0); // sprite face à droite par défaut → flip si va à gauche
      }
    }
    // Miaou quand un joueur est proche (cooldown aléatoire).
    if (now >= this.catLastMeow + 6000) {
      const near = Math.hypot(localX - cat.x, localY - cat.y) < CAT_MEOW_RANGE;
      if (near) {
        playMeow();
        this.catLastMeow = now + Math.random() * 6000; // 6–12 s avant le prochain
      }
    }
  }

  private createNpcs(): void {
    for (const n of NPCS) {
      const npc = new Npc(this.scene, n.x, n.y, n.appearance, n.dir).bob(n.bob[0], n.bob[1]);
      this.npcs.push(npc);
    }
  }

  private ensureTextures(): void {
    const s = this.scene;
    if (!s.textures.exists('fx_dot')) {
      const g = s.make.graphics({ x: 0, y: 0 }, false);
      // disque doux (dégradé d'alpha) pour fumée/feu
      for (let r = 8; r >= 1; r--) {
        g.fillStyle(0xffffff, 0.16);
        g.fillCircle(8, 8, r);
      }
      g.generateTexture('fx_dot', 16, 16);
      g.destroy();
    }
    if (!s.textures.exists('fx_butterfly')) {
      const g = s.make.graphics({ x: 0, y: 0 }, false);
      // petit papillon : 2 ailes + corps (blanc, teinté ensuite)
      g.fillStyle(0xffffff, 1);
      g.fillEllipse(4, 6, 7, 9);
      g.fillEllipse(10, 6, 7, 9);
      g.fillStyle(0x333333, 1);
      g.fillRect(6, 2, 2, 9);
      g.generateTexture('fx_butterfly', 14, 12);
      g.destroy();
    }
  }

  private createFire(): void {
    for (const p of FIRE_SPOTS) {
      // lueur vacillante
      const glow = this.scene.add.image(p.x, p.y, 'fx_dot')
        .setTint(0xff7a18).setScale(4).setAlpha(0.5).setDepth(4).setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: glow, alpha: 0.28, scaleX: 3.4, scaleY: 3.0,
        duration: 140, yoyo: true, repeat: -1, ease: 'Sine.InOut',
      });
      this.objs.push(glow);
      // flammes qui montent
      const fire = this.scene.add.particles(p.x, p.y + 4, 'fx_dot', {
        lifespan: { min: 380, max: 640 },
        speedY: { min: -55, max: -22 },
        speedX: { min: -10, max: 10 },
        scale: { start: 1.1, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffd24a, 0xff8a1e, 0xff4d1e],
        blendMode: Phaser.BlendModes.ADD,
        frequency: 60,
        quantity: 1,
      }).setDepth(5);
      this.objs.push(fire);
    }
  }

  private createSteam(): void {
    for (const p of STEAM_SPOTS) {
      const steam = this.scene.add.particles(p.x, p.y, 'fx_dot', {
        lifespan: { min: 1300, max: 2000 },
        speedY: { min: -30, max: -16 },
        speedX: { min: -7, max: 7 },
        scale: { start: 0.4, end: 1.4 },
        alpha: { start: 0.62, end: 0 },
        tint: 0xf2f2f2,
        frequency: 160,
        quantity: 1,
      }).setDepth(8);
      this.objs.push(steam);
    }
  }

  private createButterflies(): void {
    const z = BUTTERFLY_ZONE;
    for (let i = 0; i < N_BUTTERFLIES; i++) {
      // pas de Math.random au runtime initial : on étale via i (déterministe)
      const x = z.x0 + ((i * 263) % (z.x1 - z.x0));
      const y = z.y0 + ((i * 91) % (z.y1 - z.y0));
      const s = this.scene.add.sprite(x, y, 'fx_butterfly')
        .setDepth(6).setTint(BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]!).setScale(1);
      // battement d'ailes
      this.scene.tweens.add({
        targets: s, scaleX: 0.3, duration: 120 + (i % 4) * 20,
        yoyo: true, repeat: -1, ease: 'Sine.InOut',
      });
      this.objs.push(s);
      this.butterflies.push({ s, tx: x, ty: y, speed: 26 + (i % 5) * 6, phase: i });
    }
  }

  private createGreeters(): void {
    for (const g of GREETERS) {
      const bubble = this.scene.add.text(g.x, g.y, g.text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#ffffff',
        backgroundColor: '#1e293be6',
        padding: { x: 9, y: 6 },
        align: 'left',
        lineSpacing: 3,
      }).setOrigin(g.originX ?? 0.5, 1).setDepth(16).setAlpha(0).setScale(0.9);
      this.objs.push(bubble);
      this.greeters.push({ bubble, x: g.x, y: g.y, radius: g.radius, shown: false });
    }
  }

  /** Appelé chaque frame depuis GameScene.update() avec la position du joueur local. */
  update(localX: number, localY: number, dt: number): void {
    this.updateCat(localX, localY, dt, Date.now());
    const z = BUTTERFLY_ZONE;
    for (const b of this.butterflies) {
      const dx = b.tx - b.s.x;
      const dy = b.ty - b.s.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) {
        // nouvelle cible pseudo-aléatoire (basée sur la position courante, sans Math.random)
        b.phase += 1;
        b.tx = z.x0 + ((Math.abs(Math.floor(b.s.x * 7 + b.phase * 131))) % (z.x1 - z.x0));
        b.ty = z.y0 + ((Math.abs(Math.floor(b.s.y * 13 + b.phase * 57))) % (z.y1 - z.y0));
      } else {
        const step = (b.speed * dt) / 1000;
        b.s.x += (dx / d) * step;
        // léger flottement vertical
        b.s.y += (dy / d) * step + Math.sin((b.s.x + b.phase * 40) / 26) * 0.25;
        b.s.setFlipX(dx < 0);
      }
    }

    for (const g of this.greeters) {
      const near = Math.hypot(localX - g.x, localY - g.y) < g.radius;
      if (near && !g.shown) {
        g.shown = true;
        this.scene.tweens.add({ targets: g.bubble, alpha: 1, scale: 1, duration: 180, ease: 'Back.Out' });
      } else if (!near && g.shown) {
        g.shown = false;
        this.scene.tweens.add({ targets: g.bubble, alpha: 0, scale: 0.9, duration: 160 });
      }
    }
  }

  destroy(): void {
    for (const o of this.objs) o.destroy();
    for (const n of this.npcs) n.destroy();
    this.objs.length = 0;
    this.butterflies = [];
    this.greeters = [];
    this.npcs = [];
    this.cat = undefined;
  }
}
