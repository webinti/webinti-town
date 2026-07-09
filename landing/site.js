/* Webinti Town — JS partagé : smooth scroll (Lenis) + reveals (GSAP) */
gsap.registerPlugin(ScrollTrigger);
const lenis = new Lenis({ lerp: 0.11 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

document.querySelectorAll('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); lenis.scrollTo(t, { offset: -70 }); }
  }),
);

gsap.utils.toArray('.rv').forEach((el, i) => {
  gsap.to(el, {
    opacity: 1, y: 0, duration: 0.8, ease: 'power3.out',
    delay: i < 6 ? i * 0.07 : 0,
    scrollTrigger: { trigger: el, start: 'top 88%' },
  });
});

/* ─── Hero « vivant » (page d'accueil uniquement) ──────────────────────────
   Avatars pixel-art qui marchent dans les couloirs de la map, FX de proximité
   (bulle + mini-mosaïque vidéo), vie ambiante (halos d'écran, vapeur, papillons)
   et cartes UI flottantes en 2.5D. Le même site.js sert toutes les pages : tout
   est encapsulé et ne s'initialise que si #heroScene existe. Respecte
   prefers-reduced-motion (les éléments restent visibles, mais figés). */
(function heroScene() {
  const scene = document.getElementById('heroScene');
  if (!scene || typeof gsap === 'undefined') return;
  const mapbox = scene.querySelector('.mapbox');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Orientation + état de marche d'un avatar (pilote les classes CSS).
  const FACES = ['face-left', 'face-right', 'face-down'];
  function face(el, dir, walking) {
    if (!el) return;
    FACES.forEach((c) => el.classList.remove(c));
    el.classList.add('face-' + dir);
    el.classList.toggle('walk', !!walking);
  }

  // ── Vie ambiante : halos d'écrans, vapeur de café, papillons du parc ──
  const amb = document.getElementById('heroAmb');
  if (amb) {
    // Écrans détectés dans map-hero.png (centres en % de la map).
    const SCREENS = [
      [29.4, 31], [34.7, 31], [45.4, 31], [54.3, 31], [65, 31], [70.4, 31],
      [29.4, 42.5], [34.7, 42.5], [45.4, 42.5], [54.3, 42.5], [65, 42.5], [70.4, 42.5],
      [15.5, 70],
    ];
    SCREENS.forEach(([x, y], i) => {
      const h = document.createElement('div');
      h.className = 'halo';
      h.style.left = x + '%'; h.style.top = y + '%';
      h.style.animationDelay = (-i * 0.42) + 's';
      amb.appendChild(h);
    });
    // Vapeur qui monte des machines à café (coin pause du lounge).
    [[30.5, 60, 0], [31.4, 60, -1.1], [29.7, 60, -2.3]].forEach(([x, y, d]) => {
      const s = document.createElement('div');
      s.className = 'steam';
      s.style.left = x + '%'; s.style.top = y + '%'; s.style.animationDelay = d + 's';
      amb.appendChild(s);
    });
    // Papillons au-dessus du parc (partie haute de la map).
    [[12, 11, '#e58bc0', 0, 15], [58, 8, '#8bb7e5', -4, 13], [40, 14, '#e5c96f', -8, 17]]
      .forEach(([x, y, c, d, dur]) => {
        const b = document.createElement('div');
        b.className = 'bfly';
        b.style.left = x + '%'; b.style.top = y + '%';
        b.style.setProperty('--bf', c);
        b.style.animationDelay = d + 's'; b.style.animationDuration = dur + 's';
        amb.appendChild(b);
      });
  }

  const lea = document.getElementById('av-lea');
  const marc = document.getElementById('av-marc');
  const sofia = document.getElementById('av-sofia');
  const hugo = document.getElementById('av-hugo');
  const bubble = document.getElementById('heroBubble');
  const vid = document.getElementById('heroVid');

  // Ancrage par les pieds via GSAP (translate -50%,-100% + décalage x/y en px).
  [lea, marc, sofia, hugo].forEach((el) => el && gsap.set(el, { xPercent: -50, yPercent: -100, x: 0, y: 0 }));

  // Conversion « delta en % de la map » → pixels (dépend de la taille rendue).
  const px = (dxPct) => (dxPct / 100) * mapbox.clientWidth;

  // ── Cartes flottantes 2.5D : profondeur (translateZ) + parallaxe scroll ──
  [['#fc-name', 34, 20, -26], ['#fc-avail', 62, 30, -36], ['#fc-chat', 48, -16, 26]]
    .forEach(([sel, z, y0, y1]) => {
      const el = scene.querySelector(sel);
      if (!el) return;
      if (reduce) { gsap.set(el, { z: z, y: (y0 + y1) / 2 }); return; }
      gsap.set(el, { z: z, y: y0 });
      gsap.to(el, {
        y: y1, ease: 'none',
        scrollTrigger: { trigger: scene, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
      });
    });

  // ── Mode « animations réduites » : tableau statique, rien ne bouge ──
  if (reduce) {
    gsap.set(lea, { x: px(16) }); face(lea, 'right', false); // Léa a rejoint Marc
    face(marc, 'left', false);
    gsap.set(bubble, { xPercent: -50, yPercent: -100, scale: 1, opacity: 1 });
    return;
  }

  // ── Chorégraphie en boucle (28 s) — pilotée par une timeline GSAP ──
  let tl;
  function build() {
    if (tl) tl.kill();
    // Réinitialise positions/orientations de départ.
    gsap.set([lea, sofia, hugo], { x: 0 });
    face(lea, 'right', false); face(marc, 'down', false);
    face(sofia, 'right', false); face(hugo, 'left', false);

    const LEA = px(16), SOF = px(20), HUG = px(-14);
    tl = gsap.timeline({ repeat: -1, defaults: { ease: 'none' } });

    // Léa : traverse l'open-space vers la droite, rejoint Marc, puis repart.
    tl.call(() => face(lea, 'right', true), null, 3)
      .to(lea, { x: LEA, duration: 5.5 }, 3)
      .call(() => face(lea, 'right', false), null, 8.5)
      .call(() => face(lea, 'left', true), null, 20)
      .to(lea, { x: 0, duration: 5.5 }, 20)
      .call(() => face(lea, 'right', false), null, 25.5);

    // Marc : idle, se tourne vers Léa à son arrivée, puis se remet de face.
    tl.call(() => face(marc, 'left', false), null, 8.7)
      .call(() => face(marc, 'down', false), null, 19.6);

    // FX de proximité : la bulle pop (Back.out), puis la mini-mosaïque vidéo.
    tl.set(bubble, { xPercent: -50, yPercent: -100, scale: 0, opacity: 0 }, 0)
      .to(bubble, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2)' }, 9.4)
      .to(bubble, { scale: 0, opacity: 0, duration: 0.3, ease: 'back.in(2)' }, 12.2)
      .set(vid, { xPercent: -50, yPercent: -100, scale: 0, opacity: 0 }, 0)
      .to(vid, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' }, 12.4)
      .to(vid, { scale: 0, opacity: 0, duration: 0.35, ease: 'back.in(1.7)' }, 18);

    // Sofia (lounge) — aller-retour désynchronisé.
    tl.call(() => face(sofia, 'right', true), null, 5)
      .to(sofia, { x: SOF, duration: 5 }, 5)
      .call(() => face(sofia, 'down', false), null, 10)
      .call(() => face(sofia, 'left', true), null, 15)
      .to(sofia, { x: 0, duration: 5 }, 15)
      .call(() => face(sofia, 'right', false), null, 20);

    // Hugo (open-space, côté droit) — aller-retour désynchronisé.
    tl.call(() => face(hugo, 'left', true), null, 6.5)
      .to(hugo, { x: HUG, duration: 4.5 }, 6.5)
      .call(() => face(hugo, 'down', false), null, 11)
      .call(() => face(hugo, 'right', true), null, 21)
      .to(hugo, { x: 0, duration: 4.5 }, 21)
      .call(() => face(hugo, 'left', false), null, 25.5);

    // Bouclage propre à 28 s (petite pause finale).
    tl.to({}, { duration: 2.5 }, 25.5);
  }

  build();
  // Recalcule les trajectoires (en px) au redimensionnement.
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(build, 250); });
})();
