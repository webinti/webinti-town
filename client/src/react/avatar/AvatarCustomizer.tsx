import type { Appearance } from '../../types';
import {
  SKIN_COUNT,
  OUTFIT_COUNT,
  HAIR_STYLE_COUNT,
  HAIR_COLOR_COUNT,
} from '../../types';

const FRAME_W = 32;
const FRAME_H = 64;

const HAIR_STYLE_LABELS = ['Court', 'Ondulé', 'Mi-long', 'Bouclé', 'Long', 'Chignon'];
// Pastilles indicatives pour les couleurs de cheveux LimeZu (variantes 01-04).
const HAIR_COLOR_SWATCHES = ['#3b2a1a', '#6b4423', '#c98a3a', '#1a1a1a'];

const hairVariantOf = (a: Appearance) => a.hairStyle * HAIR_COLOR_COUNT + a.hairColor;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// Sanitise une apparence (ex. champ JSON PocketBase) vers un Appearance valide et borné.
export function clampAppearance(a: unknown): Appearance {
  const o = (a && typeof a === 'object' ? a : {}) as Partial<Appearance>;
  const clamp = (v: unknown, max: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
    return Math.max(0, Math.min(max, n));
  };
  return {
    skin: clamp(o.skin, SKIN_COUNT - 1),
    outfit: clamp(o.outfit, OUTFIT_COUNT - 1),
    hairStyle: clamp(o.hairStyle, HAIR_STYLE_COUNT - 1),
    hairColor: clamp(o.hairColor, HAIR_COLOR_COUNT - 1),
  };
}

// Affiche la frame "face, idle" (col 0) en superposant les 3 couches.
// Layout des planches: row = variante*4 + dir ; frame face-idle = variante*4.
export function AvatarPreview({ appearance, scale }: { appearance: Appearance; scale: number }) {
  const w = FRAME_W * scale;
  const h = FRAME_H * scale;

  const layerStyle = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: w,
    height: h,
    imageRendering: 'pixelated' as const,
    backgroundRepeat: 'no-repeat' as const,
  };

  const layer = (file: string, variant: number, count: number) => ({
    ...layerStyle,
    backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/${file}.png')`,
    backgroundSize: `${3 * w}px ${count * 4 * h}px`,
    backgroundPosition: `0px -${variant * 4 * h}px`,
  });

  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <div style={layer('body', appearance.skin, SKIN_COUNT)} />
      <div style={layer('outfit', appearance.outfit, OUTFIT_COUNT)} />
      <div style={layer('hair', hairVariantOf(appearance), HAIR_STYLE_COUNT * HAIR_COLOR_COUNT)} />
    </div>
  );
}

function Swatch({ color, selected, onClick, label }: {
  color: string; selected: boolean; onClick: () => void; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`h-8 w-8 rounded-full ring-2 transition ${
        selected ? 'ring-indigo-400 scale-110' : 'ring-slate-700 hover:ring-slate-500'
      }`}
      style={{ backgroundColor: color }}
    />
  );
}

function VariantThumb({ base, override, selected, onClick, title }: {
  base: Appearance; override: Partial<Appearance>; selected: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center overflow-hidden rounded-lg bg-slate-900/60 p-1 ring-2 transition ${
        selected ? 'ring-indigo-400 bg-indigo-500/20' : 'ring-transparent hover:ring-slate-600'
      }`}
    >
      <AvatarPreview appearance={{ ...base, ...override }} scale={1} />
    </button>
  );
}

// Grille de personnalisation (Peau / Tenue / Coiffure / Couleur). Contrôlée :
// `appearance` en entrée, `onChange` à chaque modification.
export function AvatarControls({ appearance, onChange }: {
  appearance: Appearance; onChange: (a: Appearance) => void;
}) {
  const update = <K extends keyof Appearance>(key: K, value: Appearance[K]) =>
    onChange({ ...appearance, [key]: value });

  return (
    <>
      <div className="mb-3">
        <label className="mb-2 block text-sm font-medium">Peau</label>
        <div className="flex flex-wrap gap-2">
          {range(SKIN_COUNT).map((i) => (
            <VariantThumb key={i} base={appearance} override={{ skin: i }}
              selected={appearance.skin === i} onClick={() => update('skin', i)} title={`Peau ${i + 1}`} />
          ))}
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-2 block text-sm font-medium">Tenue</label>
        <div className="flex flex-wrap gap-2">
          {range(OUTFIT_COUNT).map((i) => (
            <VariantThumb key={i} base={appearance} override={{ outfit: i }}
              selected={appearance.outfit === i} onClick={() => update('outfit', i)} title={`Tenue ${i + 1}`} />
          ))}
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-2 block text-sm font-medium">Coiffure</label>
        <div className="flex flex-wrap gap-2">
          {range(HAIR_STYLE_COUNT).map((i) => (
            <VariantThumb key={i} base={appearance} override={{ hairStyle: i }}
              selected={appearance.hairStyle === i} onClick={() => update('hairStyle', i)}
              title={HAIR_STYLE_LABELS[i] ?? `Coiffure ${i + 1}`} />
          ))}
        </div>
      </div>

      <div className="mb-2">
        <label className="mb-2 block text-sm font-medium">Couleur des cheveux</label>
        <div className="flex gap-2">
          {range(HAIR_COLOR_COUNT).map((i) => (
            <Swatch key={i} color={HAIR_COLOR_SWATCHES[i] ?? '#888'}
              selected={appearance.hairColor === i} onClick={() => update('hairColor', i)} label={`Cheveux ${i + 1}`} />
          ))}
        </div>
      </div>
    </>
  );
}
