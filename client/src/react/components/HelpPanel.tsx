import { useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';

interface ShortcutRow {
  keys: string;
  desc: string;
}
interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Déplacement',
    rows: [{ keys: 'WASD / Flèches', desc: "Bouger l'avatar" }],
  },
  {
    title: 'Audio / Vidéo',
    rows: [
      { keys: 'M', desc: 'Toggle micro' },
      { keys: 'V', desc: 'Toggle caméra' },
    ],
  },
  {
    title: 'Communication',
    rows: [
      { keys: 'C', desc: 'Ouvrir/fermer le chat' },
      { keys: '1', desc: '\u{1F44B} Wave' },
      { keys: '2', desc: '\u{1F44D} Thumbs up' },
      { keys: '3', desc: '\u{1F602} Laugh' },
      { keys: '4', desc: '\u{2764}\u{FE0F} Cœur' },
      { keys: '5', desc: '\u{2753} Question' },
      { keys: '6', desc: '\u{2757} Exclamation' },
      { keys: 'F', desc: '\u{1F389} Confettis (pour toute la salle)' },
    ],
  },
  {
    title: 'Interaction',
    rows: [
      { keys: 'E', desc: 'Interagir avec un objet (écran, tableau, ...)' },
      { keys: 'G', desc: 'Mode fantôme (traverser les avatars)' },
      { keys: 'B', desc: 'Afficher les collisions (debug / édition map)' },
    ],
  },
  {
    title: 'Interface',
    rows: [
      { keys: 'H ou ?', desc: 'Afficher cette aide' },
      { keys: 'Esc', desc: 'Fermer une fenêtre' },
    ],
  },
  {
    title: 'Hôte uniquement',
    rows: [
      { keys: '👥 Admin', desc: 'Liste des joueurs · mute / kick / fermer la salle' },
    ],
  },
];

export function HelpPanel() {
  const open = useGameStore((s) => s.helpOpen);
  const setOpen = useGameStore((s) => s.setHelpOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="flex max-h-[90vh] w-[480px] max-w-[95vw] flex-col rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Raccourcis clavier</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            Fermer
          </button>
        </div>
        <div className="overflow-y-auto pr-1">
          {GROUPS.map((g) => (
            <div key={g.title} className="mb-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-300">
                {g.title}
              </div>
              <div className="space-y-1">
                {g.rows.map((r) => (
                  <div key={r.keys} className="flex items-center justify-between text-sm">
                    <kbd className="rounded bg-slate-700 px-2 py-0.5 font-mono text-xs">{r.keys}</kbd>
                    <span className="ml-3 flex-1 text-right text-slate-300">{r.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-center text-xs text-slate-400">Esc pour fermer</div>
      </div>
    </div>
  );
}
