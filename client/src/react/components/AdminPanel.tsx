import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import { AvatarPreview, AvatarControls } from '../avatar/AvatarCustomizer';
import type { Appearance } from '../../types';

// Apparence par défaut d'une IA fraîchement embauchée (distincte de Marie).
const NEW_HIRE_APPEARANCE: Appearance = { skin: 3, outfit: 5, hairStyle: 2, hairColor: 1 };

/** "il y a 3 s / 12 min / 1 h 05" depuis joinedAt. */
function formatConnected(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

const SHIRT_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#f3f4f6',
];

export function AdminPanel() {
  const open = useGameStore((s) => s.adminPanelOpen);
  const setOpen = useGameStore((s) => s.setAdminPanelOpen);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const players = useGameStore((s) => s.players);
  const isHost = !!localPlayerId && localPlayerId === hostPlayerId;

  // Consignes de l'agent d'accueil « Marie » (éditables par l'hôte).
  const [aiKnowledge, setAiKnowledge] = useState('');
  const [aiStatus, setAiStatus] = useState<'idle' | 'loaded' | 'saving' | 'saved'>('idle');

  // Embauche d'IA : IA embauchées (depuis le store) + formulaire.
  const aiAgents = useGameStore((s) => s.aiAgents);
  const employees = useMemo(() => aiAgents.filter((a) => a.kind === 'employee'), [aiAgents]);
  const [hireOpen, setHireOpen] = useState(false);
  const [hName, setHName] = useState('');
  const [hRole, setHRole] = useState('');
  const [hKnowledge, setHKnowledge] = useState('');
  const [hAppearance, setHAppearance] = useState<Appearance>(NEW_HIRE_APPEARANCE);
  const [hireError, setHireError] = useState<string | null>(null);
  // null = mode embauche ; sinon = agentId en cours d'édition.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Modale dédiée pour personnaliser l'avatar (scrollable, au-dessus du panneau).
  const [avatarOpen, setAvatarOpen] = useState(false);

  useEffect(() => {
    if (!open || !isHost) return;
    const off = socketManager.onAiConfig((p) => {
      setAiKnowledge(p.knowledge);
      setAiStatus(p.saved ? 'saved' : 'loaded');
    });
    socketManager.aiGetConfig();
    return off;
  }, [open, isHost]);

  useEffect(() => {
    if (!open || !isHost) return;
    return socketManager.onAiHireError((msg) => setHireError(msg));
  }, [open, isHost]);

  // Réception de la config d'une IA (après « Modifier ») → pré-remplit le formulaire.
  useEffect(() => {
    if (!open || !isHost) return;
    return socketManager.onAiAgentConfig((cfg) => {
      if (cfg.saved) return; // simple confirmation d'enregistrement, pas un pré-remplissage
      setEditingId(cfg.agentId);
      setHName(cfg.name);
      setHRole(cfg.role);
      setHKnowledge(cfg.knowledge);
      setHAppearance(cfg.appearance);
      setHireError(null);
      setHireOpen(true);
    });
  }, [open, isHost]);

  // Horloge qui avance pour rafraîchir les durées de connexion (toutes les 15 s).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [open]);

  const sortedPlayers = useMemo(() => {
    return Array.from(players.values()).sort((a, b) => {
      if (a.playerId === hostPlayerId) return -1;
      if (b.playerId === hostPlayerId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [players, hostPlayerId]);

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

  if (!open || !isHost) return null;

  const handleMuteAll = () => {
    socketManager.adminMuteAll();
  };

  const handleCloseRoom = () => {
    if (!window.confirm('Déconnecter tous les joueurs (sauf vous) ?')) return;
    socketManager.adminCloseRoom();
  };

  const handleSaveAi = () => {
    setAiStatus('saving');
    socketManager.aiSetConfig(aiKnowledge);
  };

  const closeForm = () => {
    setHireOpen(false);
    setEditingId(null);
    setHName('');
    setHRole('');
    setHKnowledge('');
    setHAppearance(NEW_HIRE_APPEARANCE);
  };

  const openHireForm = () => {
    setEditingId(null);
    setHName('');
    setHRole('');
    setHKnowledge('');
    setHAppearance(NEW_HIRE_APPEARANCE);
    setHireError(null);
    setHireOpen(true);
  };

  // « Modifier » : demande la config au serveur ; onAiAgentConfig pré-remplit + ouvre.
  const handleEdit = (agentId: string) => {
    setHireError(null);
    socketManager.aiGetAgent(agentId);
  };

  const handleSubmit = () => {
    const name = hName.trim();
    if (!name) return;
    setHireError(null);
    if (editingId) {
      socketManager.aiUpdate({ agentId: editingId, name, role: hRole.trim(), knowledge: hKnowledge, appearance: hAppearance });
    } else {
      socketManager.aiHire({ name, role: hRole.trim(), knowledge: hKnowledge, appearance: hAppearance });
    }
    closeForm();
  };

  return (
    <>
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="flex max-h-[90vh] w-[520px] max-w-[95vw] flex-col rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Admin · Joueurs ({sortedPlayers.length})</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            Fermer
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            onClick={handleMuteAll}
            className="flex-1 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold hover:bg-amber-500"
          >
            Tout muter
          </button>
          <button
            onClick={handleCloseRoom}
            className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold hover:bg-red-500"
          >
            Fermer la salle
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-slate-800/60 p-3 ring-1 ring-white/5">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-sm font-semibold">🛎️ Assistant d'accueil · Marie</h3>
            {aiStatus === 'saved' && <span className="text-xs text-emerald-400">Enregistré ✓</span>}
            {aiStatus === 'saving' && <span className="text-xs text-slate-400">Enregistrement…</span>}
          </div>
          <p className="mb-2 text-[11px] leading-snug text-slate-400">
            Infos et FAQ que Marie utilisera en priorité pour répondre. Une consigne par ligne,
            p. ex. : « Horaires : 9h–18h. Pour une démo : contact@webinti.com. Le wifi invité est
            Webinti-Guest. »
          </p>
          <textarea
            value={aiKnowledge}
            onChange={(e) => {
              setAiKnowledge(e.target.value);
              setAiStatus('loaded');
            }}
            rows={6}
            maxLength={6000}
            placeholder="Ce que Marie doit savoir et comment répondre…"
            className="w-full resize-y rounded-md bg-slate-900 p-2 text-xs text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{aiKnowledge.length}/6000</span>
            <button
              onClick={handleSaveAi}
              disabled={aiStatus === 'saving'}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>
        </div>

        {/* ── Embauche d'IA ── */}
        <div className="mb-4 rounded-lg bg-slate-800/60 p-3 ring-1 ring-white/5">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-sm font-semibold">🤖 Embaucher une IA</h3>
            <span className="text-[11px] text-slate-400">{employees.length}/8</span>
          </div>

          {employees.length > 0 && (
            <ul className="mb-2 space-y-1">
              {employees.map((e) => (
                <li
                  key={e.agentId}
                  className="flex items-center gap-2 rounded-md bg-slate-900/60 px-2 py-1 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <b>{e.name}</b>
                    {e.role ? <span className="text-slate-400"> · {e.role}</span> : null}
                  </span>
                  <button
                    onClick={() => handleEdit(e.agentId)}
                    title="Modifier le prompt / l'avatar"
                    className="flex-none rounded bg-indigo-600/80 px-2 py-0.5 text-[11px] font-semibold hover:bg-indigo-500"
                  >
                    ✏️ Modifier
                  </button>
                  <button
                    onClick={() => socketManager.aiFire(e.agentId)}
                    className="flex-none rounded bg-red-600/80 px-2 py-0.5 text-[11px] font-semibold hover:bg-red-500"
                  >
                    Licencier
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!hireOpen ? (
            <button
              onClick={openHireForm}
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold hover:bg-emerald-500"
            >
              + Embaucher une IA
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] leading-snug text-slate-400">
                {editingId
                  ? "Modifiez le nom, le rôle, les instructions (FAQ/prompt) et l'avatar de cette IA."
                  : "L'IA apparaîtra là où vous vous tenez et répondra aux personnes proches dans le chat de proximité."}
              </p>
              <div className="flex gap-3">
                <div className="flex-none rounded-md bg-slate-900/60 p-2 ring-1 ring-white/10">
                  <AvatarPreview appearance={hAppearance} scale={2} />
                </div>
                <div className="flex-1 space-y-1.5">
                  <input
                    value={hName}
                    onChange={(e) => setHName(e.target.value)}
                    maxLength={20}
                    placeholder="Nom (ex. Léa)"
                    className="w-full rounded-md bg-slate-900 px-2 py-1 text-xs ring-1 ring-white/10 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <input
                    value={hRole}
                    onChange={(e) => setHRole(e.target.value)}
                    maxLength={60}
                    placeholder="Rôle (ex. Support formation)"
                    className="w-full rounded-md bg-slate-900 px-2 py-1 text-xs ring-1 ring-white/10 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <textarea
                value={hKnowledge}
                onChange={(e) => setHKnowledge(e.target.value)}
                rows={3}
                maxLength={6000}
                placeholder="Ce qu'elle sait / sa FAQ (une info par ligne)…"
                className="w-full resize-y rounded-md bg-slate-900 p-2 text-xs ring-1 ring-white/10 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setAvatarOpen(true)}
                className="w-full rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
              >
                🎨 Personnaliser l'avatar
              </button>
              {hireError && (
                <div className="rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-300 ring-1 ring-red-500/30">
                  {hireError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={!hName.trim()}
                  className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {editingId ? 'Enregistrer' : 'Embaucher'}
                </button>
                <button
                  onClick={closeForm}
                  className="rounded-md bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-y-auto pr-1">
          <ul className="space-y-1.5">
            {sortedPlayers.map((p) => {
              const isSelf = p.playerId === localPlayerId;
              const color = SHIRT_COLORS[p.appearance.outfit % SHIRT_COLORS.length];
              return (
                <li
                  key={p.playerId}
                  className="flex items-center gap-3 rounded-lg bg-slate-800/60 px-3 py-2 ring-1 ring-white/5"
                >
                  <span
                    className="h-3 w-3 flex-none rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {p.name}
                      {isSelf && (
                        <span className="ml-1 text-xs text-slate-400">(vous)</span>
                      )}
                      {p.playerId === hostPlayerId && (
                        <span className="ml-1 rounded bg-amber-500/30 px-1 text-[10px] font-semibold uppercase text-amber-200">
                          hôte
                        </span>
                      )}
                    </div>
                    {typeof p.joinedAt === 'number' && (
                      <div className="text-[11px] text-slate-400">
                        connecté depuis {formatConnected(now - p.joinedAt)}
                      </div>
                    )}
                  </div>
                  <button
                    disabled={isSelf}
                    title="Promouvoir hôte"
                    onClick={() => {
                      if (!window.confirm(`Transférer le rôle d'hôte à ${p.name} ?`)) return;
                      socketManager.adminTransferHost(p.playerId);
                      setOpen(false);
                    }}
                    className="rounded-md bg-indigo-600/80 px-2.5 py-1 text-xs font-semibold hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    👑
                  </button>
                  <button
                    disabled={isSelf}
                    onClick={() => socketManager.adminMute(p.playerId)}
                    className="rounded-md bg-amber-600/80 px-2.5 py-1 text-xs font-semibold hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Mute
                  </button>
                  <button
                    disabled={isSelf}
                    onClick={() => {
                      if (!window.confirm(`Expulser ${p.name} ?`)) return;
                      socketManager.adminKick(p.playerId);
                    }}
                    className="rounded-md bg-red-600/80 px-2.5 py-1 text-xs font-semibold hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Kick
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-3 text-center text-xs text-slate-400">Esc pour fermer</div>
      </div>
    </div>

      {avatarOpen && (
        <div
          className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setAvatarOpen(false); }}
        >
          <div className="flex max-h-[88vh] w-[420px] max-w-[95vw] flex-col rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Avatar de l'IA</h3>
              <button
                onClick={() => setAvatarOpen(false)}
                className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-semibold hover:bg-indigo-500"
              >
                Valider
              </button>
            </div>
            <div className="mb-3 flex justify-center">
              <div className="rounded-lg bg-slate-900/60 p-3 ring-1 ring-slate-700">
                <AvatarPreview appearance={hAppearance} scale={3} />
              </div>
            </div>
            <div className="overflow-y-auto pr-1">
              <AvatarControls appearance={hAppearance} onChange={setHAppearance} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
