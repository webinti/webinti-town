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

/* ───────── Sélecteur de palette LIVE ─────────
   Change la couleur d'accent du site en direct (test de DA).
   Persisté en localStorage. Décliné en 4 variables :
   --accent (base), --accent-d (foncé), --accent-l (clair), --accent-soft (halo). */
const PALETTES = [
  ['Aubergine', '#7A3B6E'],
  ['Violet',    '#6D4AFF'],
  ['Indigo',    '#3B5BDB'],
  ['Émeraude',  '#0F8A5F'],
  ['Bleu nuit', '#1E3A8A'],
  ['Encre',     '#211A2E'],
];
function shade(hex, f) { // f<0 assombrit, f>0 éclaircit
  const n = parseInt(hex.slice(1), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const t = f < 0 ? 0 : 255, a = Math.abs(f);
  r = Math.round((t - r) * a + r); g = Math.round((t - g) * a + g); b = Math.round((t - b) * a + b);
  return `rgb(${r},${g},${b})`;
}
function applyAccent(hex) {
  const s = document.documentElement.style;
  s.setProperty('--accent', hex);
  s.setProperty('--accent-d', shade(hex, -0.25));
  s.setProperty('--accent-l', shade(hex, 0.55));
  const n = parseInt(hex.slice(1), 16);
  s.setProperty('--accent-soft', `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},.13)`);
  try { localStorage.setItem('wt-accent', hex); } catch (e) {}
}
const saved = (() => { try { return localStorage.getItem('wt-accent'); } catch (e) { return null; } })();
if (saved) applyAccent(saved);

const pal = document.createElement('div');
pal.innerHTML = `
  <button id="palTgl" title="Tester une couleur d'accent" aria-label="Palette de couleurs">🎨</button>
  <div id="palBox">
    <div class="palTitle">Couleur d'accent</div>
    <div class="palRow">${PALETTES.map(([n, c]) =>
      `<button class="palSw" data-c="${c}" title="${n}" style="background:${c}"></button>`).join('')}
      <label class="palCustom" title="Couleur personnalisée">+<input type="color" id="palPick" value="${saved || '#7A3B6E'}"></label>
    </div>
  </div>`;
pal.id = 'palWidget';
const palCss = document.createElement('style');
palCss.textContent = `
#palWidget{position:fixed;right:18px;bottom:18px;z-index:500;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
#palTgl{width:46px;height:46px;border-radius:50%;border:1px solid var(--line);background:#fff;font-size:1.25rem;cursor:pointer;box-shadow:0 10px 26px -10px rgba(33,26,46,.4);transition:transform .15s}
#palTgl:hover{transform:scale(1.08)}
#palBox{display:none;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px;box-shadow:0 18px 40px -16px rgba(33,26,46,.35)}
#palWidget.open #palBox{display:block}
.palTitle{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--soft);margin-bottom:9px}
.palRow{display:flex;gap:8px;align-items:center}
.palSw{width:26px;height:26px;border-radius:50%;border:2px solid #fff;outline:1px solid var(--line);cursor:pointer;transition:transform .12s}
.palSw:hover{transform:scale(1.18)}
.palCustom{width:26px;height:26px;border-radius:50%;border:1.5px dashed var(--soft);display:grid;place-items:center;font-weight:800;color:var(--soft);cursor:pointer;position:relative;font-size:.9rem}
.palCustom input{position:absolute;inset:0;opacity:0;cursor:pointer}`;
document.head.appendChild(palCss);
document.body.appendChild(pal);
document.getElementById('palTgl').addEventListener('click', () => pal.classList.toggle('open'));
pal.querySelectorAll('.palSw').forEach((b) => b.addEventListener('click', () => applyAccent(b.dataset.c)));
document.getElementById('palPick').addEventListener('input', (e) => applyAccent(e.target.value));
