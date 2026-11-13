import { useState, useEffect, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChefHat,
  Clock,
  ExternalLink,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Loader2,
  Check,
  Heart,
  Search,
  CalendarDays,
  Link2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import { MealPlannerModal, quickSlotOptions } from '@/components/ui/MealPlannerModal';
import { RecipeImportModal } from '@/components/ui/RecipeImportModal';
import { useRecipesStore, useBridge, useShoppingStore, useStore } from '@/store';
import { toasts } from '@/components/ui/ToastProvider';
import { hapticSuccess, hapticTap } from '@/lib/haptics';
import type { RecipeSuggestion , RecipeQuery, RecipeRecommendations } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Recipe Module
//
// UX :
//   - Grille de cards 2 colonnes avec pop-in staggeré (spring, délai index*0.06s)
//   - Score de matching : barre de progression colorée + pourcentage
//   - Survol → setHighlightedMeshIds(recipe.availableInMeshIds) → glow 3D
//   - ★ Favori toggle avec toast personnalisé
//   - Ingrédients manquants en badge warning
//   - Clic sur "voir la recette" → nouvel onglet
// ─────────────────────────────────────────────────────────────────────────────

// ── Score color helper ────────────────────────────────────────────────────────

function matchColor(score: number): string {
  if (score >= 0.85) return '#00e676';   // green
  if (score >= 0.60) return '#4fc3f7';   // blue
  if (score >= 0.40) return '#f59e0b';   // amber
  return '#ff6b6b';                      // red
}

function matchLabel(score: number): string {
  if (score >= 0.85) return 'PARFAIT';
  if (score >= 0.60) return 'BON';
  if (score >= 0.40) return 'POSSIBLE';
  return 'INCOMPLET';
}

// ── Match Score Bar ───────────────────────────────────────────────────────────

function MatchScoreBar({ score }: { score: number }) {
  const color  = matchColor(score);
  const pct    = Math.round(score * 100);
  const label  = matchLabel(score);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs" style={{ color }}>{label}</span>
        <span className="font-mono text-2xs text-text-tertiary">{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}80` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.2 }}
        />
      </div>
    </div>
  );
}

// ── Recipe Card ───────────────────────────────────────────────────────────────

const CARD_VARIANTS = {
  hidden:  { opacity: 0, y: 20, scale: 0.93 },
  visible: { opacity: 1, y: 0,  scale: 1 },
  exit:    { opacity: 0, scale: 0.95 },
};

function RecipeCard({
  recipe,
  index,
  isFavorite,
  isPinned,
  onToggleFavorite,
  onTogglePin,
  onPlanify,
}: {
  recipe: RecipeSuggestion;
  index: number;
  isFavorite: boolean;
  isPinned: boolean;
  onToggleFavorite: (recipe: RecipeSuggestion) => void;
  onTogglePin: (recipe: RecipeSuggestion) => void;
  onPlanify: (recipe: RecipeSuggestion) => void;
}) {
  const { setHighlightedMeshIds } = useBridge();
  const [imgError, setImgError] = useState(false);
  // Pont Recettes → Courses : état du bouton d'ajout groupé
  const [batchState, setBatchState] = useState<'idle' | 'loading' | 'done'>('idle');
  const setShoppingList = useShoppingStore((s) => s.setShoppingList);
  const color = matchColor(recipe.matchScore);
  const usedCount = recipe.usedIngredients?.length ?? 0;
  const totalCount = recipe.totalIngredients ?? (usedCount + recipe.missingIngredients.length);

  const handleMouseEnter = () => {
    if (recipe.availableInMeshIds?.length) {
      setHighlightedMeshIds(recipe.availableInMeshIds);
    }
  };

  const handleMouseLeave = () => {
    // Le clic « épingle » la mise en valeur (indispensable sur mobile, sans hover)
    if (!isPinned) setHighlightedMeshIds([]);
  };

  /**
   * Envoie tous les ingrédients manquants dans la liste de courses active.
   * Le backend déduplique et renvoie la liste complète → on hydrate le store
   * pour que l'onglet COURSES affiche les articles sans attendre un refetch.
   */
  const handleAddMissingToShopping = async (event: ReactMouseEvent) => {
    event.stopPropagation(); // ne déclenche pas l'épinglage de la carte
    if (batchState !== 'idle' || recipe.missingIngredients.length === 0) return;

    setBatchState('loading');
    try {
      const list = await api.addMissingIngredientsToShopping(
        recipe.missingIngredients.map((name) => ({ name })),
      );
      setShoppingList(list);
      hapticSuccess();
      toasts.shoppingBatchAdd(recipe.missingIngredients.length, recipe.title);
      setBatchState('done');
    } catch (err) {
      setBatchState('idle');
      toasts.error(
        err instanceof Error ? err.message : "Impossible d'ajouter les ingrédients aux courses",
      );
    }
  };

  return (
    <motion.div
      layout
      variants={CARD_VARIANTS}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{
        type: 'spring',
        stiffness: 380,
        damping: 28,
        delay: index * 0.06,
      }}
      className={clsx(
        'group relative flex flex-col rounded-xl border overflow-hidden cursor-pointer tap',
        isPinned && 'ring-1 ring-health-ok/40',
      )}
      style={{
        borderColor: isPinned ? '#00e67666' : `${color}30`,
        background: 'linear-gradient(160deg, #14161a 0%, #0f1114 100%)',
        boxShadow: isPinned
          ? '0 6px 28px rgba(0,0,0,0.45), 0 0 0 1px #00e67633, inset 0 1px 0 rgba(255,255,255,0.04)'
          : '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => onTogglePin(recipe)}
      whileHover={{
        y: -2,
        boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px ${color}35, inset 0 1px 0 rgba(255,255,255,0.05)`,
        transition: { duration: 0.2 },
      }}
    >
      {/* Image area */}
      <div className="relative h-28 bg-surface-3 overflow-hidden flex-shrink-0">
        {recipe.imageUrl && !imgError ? (
          <>
            <img
              src={recipe.imageUrl}
              alt={recipe.title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImgError(true)}
            />
            {/* Dark gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0f1114] via-transparent to-transparent" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ChefHat size={28} className="text-text-tertiary/40" />
          </div>
        )}

        {/* Favorite button — top right */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(recipe); }}
          className={clsx(
            'absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center',
            'backdrop-blur-sm transition-all duration-200',
            isFavorite
              ? 'bg-rose-500/25 border border-rose-400/50 text-rose-300'
              : 'bg-black/40 border border-white/10 text-white/50 hover:text-rose-300 hover:border-rose-400/40',
          )}
        >
          {isFavorite ? <Heart size={12} fill="currentColor" /> : <Heart size={12} />}
        </button>

        {/* Prep time badge */}
        {recipe.prepTimeMin !== null && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5
                          bg-black/60 backdrop-blur-sm rounded border border-white/10">
            <Clock size={9} className="text-text-tertiary" />
            <span className="font-mono text-2xs text-text-secondary">{recipe.prepTimeMin} min</span>
          </div>
        )}

        {/* 3D bridge hint — only visible on hover when meshIds available */}
        {recipe.availableInMeshIds?.length ? (
          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-black/60 backdrop-blur-sm rounded border border-health-ok/30">
              <Sparkles size={8} className="text-health-ok" />
              <span className="font-mono text-2xs text-health-ok">3D</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col p-3 gap-2">
        <h3 className="font-display text-sm font-600 text-text-primary leading-tight line-clamp-2">
          {recipe.title}
        </h3>

        {/* Badge « Match Coloc » (Bloc 1) : validée par ≥ 2 colocataires */}
        {recipe.isColocMatch && (recipe.favoritedByUsers?.length ?? 0) >= 2 && (
          <div
            className="flex items-center gap-1 px-1.5 py-[2px] rounded-full border min-w-0"
            style={{
              borderColor: 'rgba(251,113,133,0.35)',
              background: 'rgba(251,113,133,0.10)',
            }}
          >
            <span className="text-[9px] leading-none">🔥</span>
            <span className="flex-1 min-w-0 truncate font-sans text-[8px] text-rose-200">
              Validé par{' '}
              {(recipe.favoritedByUsers ?? [])
                .slice(0, 2)
                .map((user) => user.name.split(' ').slice(-1)[0])
                .join(' & ')}
            </span>
            <span className="flex items-center gap-0.5 flex-shrink-0">
              {(recipe.favoritedByUsers ?? []).slice(0, 2).map((user) => (
                <span
                  key={user.id}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: user.colorHex, boxShadow: `0 0 5px ${user.colorHex}` }}
                />
              ))}
            </span>
          </div>
        )}

        <MatchScoreBar score={recipe.matchScore} />

        {/* Ingrédients en stock */}
        {totalCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-2xs text-text-tertiary tabular-nums">
              {usedCount}/{totalCount} en stock
            </span>
            {isPinned && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-health-ok/10 border border-health-ok/30">
                <Sparkles size={8} className="text-health-ok" />
                <span className="font-mono text-2xs text-health-ok">3D</span>
              </span>
            )}
            {typeof recipe.proteinGrams === 'number' && (
              <span className="ml-auto font-mono text-2xs text-amber-400 tabular-nums" title={`≈ ${recipe.proteinGrams} g de protéines par portion`}>
                ⚡ {recipe.proteinGrams} g
              </span>
            )}
          </div>
        )}

        {/* Missing ingredients */}
        {recipe.missingIngredients.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <AlertTriangle size={9} className="text-health-warning flex-shrink-0" />
              <span className="font-mono text-2xs text-health-warning/70">IL MANQUE</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {recipe.missingIngredients.slice(0, 3).map(ing => (
                <span
                  key={ing}
                  className="font-body text-2xs px-1.5 py-0.5 rounded bg-health-warning/8 border border-health-warning/20 text-health-warning/80"
                >
                  {ing}
                </span>
              ))}
              {recipe.missingIngredients.length > 3 && (
                <span className="font-mono text-2xs text-text-tertiary self-center">
                  +{recipe.missingIngredients.length - 3}
                </span>
              )}
            </div>

            {/* Pont Recettes → Courses : un tap = tous les manquants dans la liste */}
            <button
              type="button"
              onClick={handleAddMissingToShopping}
              disabled={batchState !== 'idle'}
              aria-label={`Ajouter les ${recipe.missingIngredients.length} ingrédients manquants aux courses`}
              className={clsx(
                'mt-1.5 w-full flex items-center justify-center gap-1.5 rounded-full border',
                'px-3 py-1.5 text-xs font-medium transition-all active:scale-95',
                batchState === 'done'
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400 cursor-default'
                  : 'glass-capsule border-white/10 text-cyan-400 hover:text-cyan-300',
              )}
            >
              {batchState === 'loading' ? (
                <Loader2 size={11} className="animate-spin flex-shrink-0" />
              ) : batchState === 'done' ? (
                <Check size={11} className="flex-shrink-0" />
              ) : (
                <Plus size={11} className="flex-shrink-0" />
              )}
              <span className="leading-tight text-center">
                {batchState === 'loading'
                  ? 'Ajout…'
                  : batchState === 'done'
                    ? 'Ajoutés ✓'
                    : `+ ${recipe.missingIngredients.length} aux courses`}
              </span>
            </button>
          </div>
        )}

        {recipe.missingIngredients.length === 0 && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={11} className="text-health-ok" />
            <span className="font-mono text-2xs text-health-ok">Tous les ingrédients dispo</span>
          </div>
        )}

        {/* Planification rapide (Sprint 4) */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            hapticTap();
            onPlanify(recipe);
          }}
          className="flex items-center justify-center gap-1.5 h-7 rounded-lg border border-white/10
                     bg-white/[0.03] text-slate-300 font-sans text-[9px]
                     hover:border-cyan-400/40 hover:text-cyan-300 tap transition-colors"
        >
          <CalendarDays size={9} />
          Planifier
        </button>

        {/* Source link */}
        <a
          href={recipe.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="mt-auto flex items-center gap-1.5 text-text-tertiary hover:text-accent
                     transition-colors duration-150 group/link"
        >
          <span className="font-mono text-2xs group-hover/link:text-accent">VOIR LA RECETTE</span>
          <ExternalLink size={9} />
        </a>
      </div>

      {/* Neon bottom edge glow on hover */}
      <motion.div
        className="absolute bottom-0 left-4 right-4 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
      />
    </motion.div>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

// ── Hub Recettes : barre de recherche & chips ─────────────────────────────────

type ChipId = 'available' | 'almost' | 'favorites' | 'quick' | 'protein';

const QUICK_MAX_MIN = 25;
const PROTEIN_THRESHOLD_G = 25;

const CHIPS: Array<{ id: ChipId; label: string; color: string; activeClass: string }> = [
  { id: 'available', label: '⚡ 100% Réalisable', color: '#00e676', activeClass: 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300' },
  { id: 'almost', label: '🎯 À 1 ingrédient près', color: '#22d3ee', activeClass: 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300' },
  { id: 'favorites', label: '❤️ Favoris', color: '#fb7185', activeClass: 'border-rose-400/50 bg-rose-400/15 text-rose-300' },
  { id: 'quick', label: `⏱️ < ${QUICK_MAX_MIN} min`, color: '#f59e0b', activeClass: 'border-amber-400/50 bg-amber-400/15 text-amber-300' },
  { id: 'protein', label: `💪 Protéines (>${PROTEIN_THRESHOLD_G} g)`, color: '#a78bfa', activeClass: 'border-violet-400/50 bg-violet-400/15 text-violet-300' },
];

function HubToolbar({
  search,
  onSearch,
  chips,
  onToggleChip,
  onOpenPlanner,
  onOpenImport,
  onRefresh,
  isRefreshing,
}: {
  search: string;
  onSearch: (value: string) => void;
  chips: Set<ChipId>;
  onToggleChip: (id: ChipId) => void;
  onOpenPlanner: () => void;
  onOpenImport: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div className="space-y-2 flex-shrink-0">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Rechercher une recette ou un ingrédient…"
            aria-label="Rechercher une recette"
            className="w-full h-10 bg-white/5 border border-white/10 rounded-2xl pl-9 pr-8 font-sans
                       text-[12px] text-white/90 placeholder-slate-500 focus:outline-none
                       focus:border-cyan-400/50 focus:bg-white/[0.07] transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch('')}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white tap"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Rafraîchir les recettes"
          className="w-10 h-10 rounded-2xl border border-white/10 flex items-center justify-center
                     text-text-tertiary hover:text-white hover:border-white/25 tap disabled:opacity-40"
        >
          <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
        </button>

        <button
          type="button"
          onClick={onOpenPlanner}
          className="h-10 px-3 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300
                     flex items-center gap-1.5 font-sans text-[10px] tracking-wider uppercase
                     tap hover:bg-cyan-400/20 transition-colors flex-shrink-0"
        >
          <CalendarDays size={12} />
          Semainier
        </button>
      </div>

      <button
        type="button"
        onClick={onOpenImport}
        className="w-full h-8 rounded-xl border border-white/10 bg-white/[0.04] text-slate-300
                   font-sans text-[10px] tracking-wider uppercase flex items-center justify-center gap-1.5
                   tap hover:border-cyan-400/40 hover:text-cyan-300 transition-colors"
      >
        <Link2 size={11} />
        Importer par lien
      </button>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
        {CHIPS.map((chip) => {
          const active = chips.has(chip.id);
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => onToggleChip(chip.id)}
              aria-pressed={active}
              className={`px-2.5 h-7 rounded-full border font-sans text-[10px] whitespace-nowrap
                          tap transition-colors flex-shrink-0 ${
                            active
                              ? chip.activeClass
                              : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25'
                          }`}
            >
              {chip.label}
            </button>
          )
        })}
      </div>
    </div>
  );
}

// ── Bandeau « À 1 ingrédient près » ───────────────────────────────────────────

function AlmostSection({
  recipes,
  onAddMissing,
}: {
  recipes: RecipeSuggestion[];
  onAddMissing: (recipe: RecipeSuggestion) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (recipes.length === 0) return null;

  return (
    <div className="flex-shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="label-section">🎯 À 1 INGRÉDIENT PRÈS</span>
        <span className="font-mono text-2xs text-cyan-300">{recipes.length}</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5">
        {recipes.slice(0, 8).map((recipe) => {
          const missing = recipe.missingIngredients[0];
          return (
            <div
              key={recipe.id}
              className="w-[196px] flex-shrink-0 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.05] p-2 space-y-1"
            >
              <div className="flex items-center gap-1.5">
                <span className="flex-1 min-w-0 truncate font-sans text-[11px] text-white/90">
                  {recipe.title}
                </span>
                <span className="font-mono text-[8px] text-cyan-300 tabular-nums flex-shrink-0">
                  {recipe.prepTimeMin ?? '—'} min
                </span>
              </div>
              <div className="font-mono text-[9px] text-slate-400">
                Il ne manque que : <span className="text-cyan-300">{missing}</span>
              </div>
              <button
                type="button"
                disabled={busy === recipe.id}
                onClick={async () => {
                  setBusy(recipe.id);
                  try {
                    await onAddMissing(recipe);
                  } finally {
                    setBusy(null);
                  }
                }}
                className="w-full h-6 rounded-lg border border-cyan-400/30 text-cyan-300 font-sans
                           text-[9px] flex items-center justify-center gap-1 tap
                           hover:bg-cyan-400/15 disabled:opacity-50 transition-colors"
              >
                {busy === recipe.id ? <Loader2 size={9} className="animate-spin" /> : <Plus size={9} />}
                Ajouter aux courses
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function RecipeModule() {
  const { recipeSuggestions, isRecipesLoading, recipesError,
          setRecipeSuggestions, setRecipesLoading, setRecipesError } = useRecipesStore();
  const [search, setSearch] = useState('');
  const [chips, setChips] = useState<Set<ChipId>>(new Set());
  const [toggling, setToggling] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [planTarget, setPlanTarget] = useState<RecipeSuggestion | null>(null);
  const { setHighlightedMeshIds } = useBridge();
  const setShoppingList = useShoppingStore((s) => s.setShoppingList);
  const user = useStore((s) => s.user);

  const chipsKey = useMemo(() => Array.from(chips).sort().join(','), [chips]);

  const handleTogglePin = useCallback((recipe: RecipeSuggestion) => {
    setPinnedId((current) => {
      const next = current === recipe.id ? null : recipe.id;
      setHighlightedMeshIds(next && recipe.availableInMeshIds ? recipe.availableInMeshIds : []);
      return next;
    });
  }, [setHighlightedMeshIds]);

  /** Filtrage serveur : recherche, chips, faisabilité, favoris. */
  const fetchRecipes = useCallback(async () => {
    setRecipesLoading(true);
    try {
      const query: RecipeQuery = { limit: 50 };
      if (search.trim()) query.search = search.trim();
      if (chips.has('available')) query.onlyAvailable = true;
      if (chips.has('almost')) query.onlyAlmost = true;
      if (chips.has('favorites')) query.onlyFavorites = true;
      if (chips.has('quick')) query.maxTime = QUICK_MAX_MIN;
      if (chips.has('protein')) query.minProtein = PROTEIN_THRESHOLD_G;

      const recipes = await api.getRecipeSuggestions(query);
      setRecipeSuggestions(recipes);
    } catch (err) {
      setRecipesError(err instanceof Error ? err.message : 'Erreur');
    }
  }, [search, chips, setRecipeSuggestions, setRecipesLoading, setRecipesError]);

  // Recherche instantanée (debounce léger pour ne pas marteler l'API)
  useEffect(() => {
    const timer = setTimeout(() => { void fetchRecipes(); }, 250);
    return () => clearTimeout(timer);
  }, [fetchRecipes, chipsKey]);

  const handleToggleChip = (id: ChipId) => {
    hapticTap();
    setChips((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleFavorite = async (recipe: RecipeSuggestion) => {
    if (toggling === recipe.id) return;
    setToggling(recipe.id);

    const wasFavorite = !!recipe.isFavorite;
    // Optimiste : bascule immédiate côté client
    setRecipeSuggestions(
      recipeSuggestions.map((entry) =>
        entry.id === recipe.id ? { ...entry, isFavorite: !wasFavorite } : entry,
      ),
    );

    try {
      await api.toggleFavoriteRecipe(recipe.id);
      hapticSuccess();
      if (wasFavorite) toasts.recipeUnfavorited(recipe.title);
      else             toasts.recipeFavorited(recipe.title);
      // Le filtre « Favoris » doit se recharger pour rester exact
      if (chips.has('favorites')) void fetchRecipes();
    } catch {
      setRecipeSuggestions(
        recipeSuggestions.map((entry) =>
          entry.id === recipe.id ? { ...entry, isFavorite: wasFavorite } : entry,
        ),
      );
      toasts.error('Impossible de modifier les favoris');
    } finally {
      setToggling(null);
    }
  };

  /** Pont Recettes → Courses (utilisé par le bandeau et les cartes). */
  const addMissingToShopping = useCallback(async (recipe: RecipeSuggestion) => {
    if (recipe.missingIngredients.length === 0) return;
    try {
      const list = await api.addMissingIngredientsToShopping(
        recipe.missingIngredients.map((name) => ({ name })),
      );
      setShoppingList(list);
      hapticSuccess();
      toasts.shoppingBatchAdd(recipe.missingIngredients.length, recipe.title);
    } catch (err) {
      toasts.error(
        err instanceof Error ? err.message : "Impossible d'ajouter les ingrédients aux courses",
      );
    }
  }, [setShoppingList]);

  /** Planification rapide d'une recette (Ce soir / Demain midi / Demain soir). */
  const planify = async (option: { date: string; slot: 'LUNCH' | 'DINNER' }, recipe: RecipeSuggestion) => {
    try {
      await api.upsertMealPlan({
        date: option.date,
        slot: option.slot,
        recipeId: recipe.id,
        recipeName: recipe.title,
        cookId: user?.id ?? null,
      });
      hapticSuccess();
      toasts.info('Repas planifié', `${recipe.title} — ${option.slot === 'LUNCH' ? 'midi' : 'soir'}`);
      setPlanTarget(null);
    } catch (err) {
      toasts.error('Planification impossible', err instanceof Error ? err.message : 'Erreur serveur');
    }
  };

  const readyCount = recipeSuggestions.filter(r => r.isFullyAvailable ?? r.missingIngredients.length === 0).length;
  const almostRecipes = recipeSuggestions.filter(r => r.isAlmostAvailable);
  const favoriteCount = recipeSuggestions.filter(r => r.isFavorite).length;

  return (
    <div className="h-full flex flex-col overflow-hidden gap-2.5">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-display text-2xl font-black tracking-wider text-white uppercase mt-0.5">
            Le <span className="text-accent">frigo</span> cuisine
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {readyCount > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-health-ok/10 border border-health-ok/25">
              <CheckCircle2 size={11} className="text-health-ok" />
              <span className="font-mono text-2xs text-health-ok">{readyCount} prêtes</span>
            </div>
          )}
        </div>
      </div>

      <RecommendedStrip />

      <HubToolbar
        search={search}
        onSearch={setSearch}
        chips={chips}
        onToggleChip={handleToggleChip}
        onOpenPlanner={() => { hapticTap(); setPlannerOpen(true); }}
        onOpenImport={() => { hapticTap(); setImportOpen(true); }}
        onRefresh={() => void fetchRecipes()}
        isRefreshing={isRecipesLoading}
      />

      {/* Suggestions « à 1 ingrédient près » */}
      <AlmostSection recipes={almostRecipes} onAddMissing={addMissingToShopping} />

      {/* Contenu */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-0.5 space-y-2.5">
        {isRecipesLoading && recipeSuggestions.length === 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-surface-border/30 overflow-hidden">
                <div className="h-28 bg-surface-3 animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-surface-3 rounded animate-pulse" />
                  <div className="h-2.5 bg-surface-3 rounded animate-pulse w-2/3" />
                  <div className="h-1 bg-surface-3 rounded-full animate-pulse mt-2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {recipesError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-health-critical/5 border border-health-critical/25">
            <AlertCircle size={14} className="text-health-critical flex-shrink-0" />
            <div className="flex-1">
              <span className="font-mono text-xs text-health-critical">{recipesError}</span>
              <button
                onClick={() => void fetchRecipes()}
                className="block font-mono text-2xs text-accent mt-1 hover:text-accent-bright"
              >
                Réessayer →
              </button>
            </div>
          </div>
        )}

        {!isRecipesLoading && recipeSuggestions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <ChefHat size={28} className="text-text-tertiary/40" />
            <div className="text-center">
              <div className="font-mono text-sm text-text-tertiary">AUCUNE RECETTE</div>
              <div className="font-body text-xs text-text-tertiary/60 mt-1">
                {chips.size > 0 || search
                  ? 'Aucun résultat pour ces filtres'
                  : 'Aucune suggestion disponible pour le stock actuel'}
              </div>
              {(chips.size > 0 || search) && (
                <button
                  onClick={() => { setChips(new Set()); setSearch(''); }}
                  className="font-mono text-2xs text-accent mt-2 hover:text-accent-bright"
                >
                  Réinitialiser les filtres →
                </button>
              )}
            </div>
          </div>
        )}

        {recipeSuggestions.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            <AnimatePresence mode="popLayout">
              {recipeSuggestions.map((recipe, i) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  index={i}
                  isFavorite={!!recipe.isFavorite}
                  isPinned={pinnedId === recipe.id}
                  onToggleFavorite={handleToggleFavorite}
                  onTogglePin={handleTogglePin}
                  onPlanify={setPlanTarget}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer stats */}
      {recipeSuggestions.length > 0 && (
        <div className="flex-shrink-0 pt-2 border-t border-surface-border/40 flex items-center justify-between">
          <span className="font-mono text-2xs text-text-tertiary">
            {recipeSuggestions.length} recette{recipeSuggestions.length !== 1 ? 's' : ''}
            {almostRecipes.length > 0 ? ` · ${almostRecipes.length} à 1 près` : ''}
          </span>
          <div className="flex items-center gap-1.5">
            <Heart size={10} className="text-rose-300" />
            <span className="font-mono text-2xs text-text-tertiary">
              {favoriteCount} favori{favoriteCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Import par URL (Bloc 1) */}
      <RecipeImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSaved={() => void fetchRecipes()}
      />

      {/* Semainier */}
      <MealPlannerModal
        open={plannerOpen}
        onClose={() => setPlannerOpen(false)}
        recipes={recipeSuggestions}
        initialTab="nutrition"
      />

      {/* Planification rapide d'une carte */}
      <AnimatePresence>
        {planTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPlanTarget(null)} />
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="relative w-full sm:max-w-xs m-0 sm:m-4 rounded-t-3xl sm:rounded-2xl border border-white/12
                         bg-[#0d1014]/95 p-3 space-y-2"
              style={{ backdropFilter: 'blur(24px)' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-400">
                  PLANIFIER · {planTarget.title.slice(0, 28)}
                </span>
                <button
                  type="button"
                  onClick={() => setPlanTarget(null)}
                  className="font-mono text-[9px] text-slate-500 hover:text-white tap"
                >
                  ANNULER
                </button>
              </div>
              {quickSlotOptions().map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => void planify(option, planTarget)}
                  className="w-full h-9 rounded-xl border border-white/10 bg-white/[0.04] font-sans
                             text-[11px] text-white/85 flex items-center justify-between px-3
                             tap hover:border-cyan-400/40 hover:text-cyan-300 transition-colors"
                >
                  <span>{option.label}</span>
                  <span className="font-mono text-[9px] text-slate-500">{option.date}</span>
                </button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommandé pour toi maintenant — moteur priorisé (stock + macros + Jarvis)
// ─────────────────────────────────────────────────────────────────────────────

const TAG_STYLE: Record<string, { label: string; color: string }> = {
  ANTI_GASPI: { label: 'Anti-gaspi', color: '#34d399' },
  POST_WORKOUT: { label: 'Récup séance', color: '#38bdf8' },
  CARB_LOAD_J1: { label: 'Recharge J+1', color: '#fbbf24' },
  MACRO_FIT: { label: 'Macro fit', color: '#a78bfa' },
}

function RecommendedStrip() {
  const [data, setData] = useState<RecipeRecommendations | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getRecipeRecommendations()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const items = data?.recommendations ?? []
  if (items.length === 0) return null

  return (
    <section className="flex-shrink-0">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles size={11} className="text-accent" />
        <span className="label-section">RECOMMANDÉ POUR TOI MAINTENANT</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {items.map((recipe) => (
          <div
            key={recipe.key}
            className="flex-shrink-0 w-[168px] rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden"
          >
            <div className="h-16 w-full bg-slate-800/60">
              <img src={recipe.image} alt="" className="h-full w-full object-cover opacity-80" loading="lazy" />
            </div>
            <div className="p-2">
              <div className="font-sans text-[11px] text-white/90 leading-tight line-clamp-2">
                {recipe.title}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {recipe.tags.slice(0, 2).map((tag) => {
                  const style = TAG_STYLE[tag]
                  return (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded-md font-mono text-[8px]"
                      style={{ color: style.color, backgroundColor: `${style.color}1a` }}
                    >
                      {style.label}
                    </span>
                  )
                })}
              </div>
              <div className="mt-1 font-mono text-[8px] text-slate-500">
                {recipe.stockIngredients.length}/{recipe.stockIngredients.length + recipe.missingIngredients.length} en stock · {recipe.proteinGrams} g prot
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
