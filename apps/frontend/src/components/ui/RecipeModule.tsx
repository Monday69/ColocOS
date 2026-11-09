import { useState, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChefHat, Clock, Star, ExternalLink,
  AlertCircle, Sparkles, CheckCircle2,
  AlertTriangle, RefreshCw, Plus, Loader2, Check,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import { useRecipesStore, useBridge, useShoppingStore } from '@/store';
import { toasts } from '@/components/ui/ToastProvider';
import { hapticSuccess } from '@/lib/haptics';
import type { RecipeSuggestion } from '@/types';

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
}: {
  recipe: RecipeSuggestion;
  index: number;
  isFavorite: boolean;
  isPinned: boolean;
  onToggleFavorite: (recipe: RecipeSuggestion) => void;
  onTogglePin: (recipe: RecipeSuggestion) => void;
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
              ? 'bg-amber-500/25 border border-amber-500/40 text-amber-400'
              : 'bg-black/40 border border-white/10 text-white/50 hover:text-amber-400 hover:border-amber-400/40',
          )}
        >
          {isFavorite ? <Star size={12} fill="currentColor" /> : <Star size={12} />}
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
                    ? 'Ajoutés aux courses ✓'
                    : `Ajouter les ${recipe.missingIngredients.length} manquants aux courses`}
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

type FilterMode = 'all' | 'ready' | 'quick' | 'protein';

const PROTEIN_THRESHOLD_G = 25;

function FilterTabs({ active, onChange }: { active: FilterMode; onChange: (f: FilterMode) => void }) {
  const tabs: { id: FilterMode; label: string }[] = [
    { id: 'all',   label: 'TOUT' },
    { id: 'ready', label: 'PRÊT' },
    { id: 'quick', label: '< 30 MIN' },
    { id: 'protein', label: '⚡ PROTÉINES' },
  ];

  return (
    <div className="flex gap-1 p-1 rounded-xl bg-surface-3/50 border border-surface-border/40 flex-shrink-0">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            'flex-1 py-1.5 rounded-lg font-display text-2xs tracking-widest transition-all duration-150',
            active === tab.id
              ? 'bg-accent/15 border border-accent/30 text-accent'
              : 'text-text-tertiary hover:text-text-secondary',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function RecipeModule() {
  const { recipeSuggestions, isRecipesLoading, recipesError,
          setRecipeSuggestions, setRecipesLoading, setRecipesError } = useRecipesStore();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<string | null>(null);
  // Recette « épinglée » : sa mise en valeur 3D reste active (utile sur mobile)
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const { setHighlightedMeshIds } = useBridge();

  const handleTogglePin = useCallback((recipe: RecipeSuggestion) => {
    setPinnedId((current) => {
      const next = current === recipe.id ? null : recipe.id;
      setHighlightedMeshIds(next && recipe.availableInMeshIds ? recipe.availableInMeshIds : []);
      return next;
    });
  }, [setHighlightedMeshIds]);

  // Fetch suggestions on mount
  const fetchRecipes = useCallback(async () => {
    setRecipesLoading(true);
    try {
      const recipes = await api.getRecipeSuggestions(12);
      setRecipeSuggestions(recipes);
    } catch (err) {
      setRecipesError(err instanceof Error ? err.message : 'Erreur');
    }
  }, [setRecipeSuggestions, setRecipesLoading, setRecipesError]);

  useEffect(() => {
    if (recipeSuggestions.length === 0) fetchRecipes();
  }, []);

  // Filter logic
  const filteredRecipes = recipeSuggestions.filter(r => {
    if (filter === 'ready')  return r.missingIngredients.length === 0;
    if (filter === 'quick')  return r.prepTimeMin !== null && r.prepTimeMin <= 30;
    // « Riche en protéines » : estimation par portion fournie par le catalogue local
    if (filter === 'protein') return (r.proteinGrams ?? 0) >= PROTEIN_THRESHOLD_G;
    return true;
  });

  // Favorite toggle
  const handleToggleFavorite = async (recipe: RecipeSuggestion) => {
    if (toggling === recipe.id) return;
    setToggling(recipe.id);

    const wasFavorite = favorites.has(recipe.id);
    // Optimistic
    setFavorites(prev => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(recipe.id);
      else next.add(recipe.id);
      return next;
    });

    try {
      await api.toggleFavoriteRecipe(recipe.id);
      if (wasFavorite) toasts.recipeUnfavorited(recipe.title);
      else             toasts.recipeFavorited(recipe.title);
    } catch {
      // Rollback optimistic update
      setFavorites(prev => {
        const next = new Set(prev);
        if (wasFavorite) next.add(recipe.id);
        else next.delete(recipe.id);
        return next;
      });
      toasts.error('Impossible de modifier les favoris');
    } finally {
      setToggling(null);
    }
  };

  const readyCount = recipeSuggestions.filter(r => r.missingIngredients.length === 0).length;

  return (
    <div className="h-full flex flex-col overflow-hidden gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <div className="label-section">MOTEUR DE RECETTES</div>
          <h2 className="font-display text-xl font-600 text-text-primary mt-0.5">
            Suggestions <span className="text-accent font-300">du frigo</span>
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Ready count badge */}
          {readyCount > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-health-ok/10 border border-health-ok/25">
              <CheckCircle2 size={11} className="text-health-ok" />
              <span className="font-mono text-2xs text-health-ok">{readyCount} prêtes</span>
            </div>
          )}
          {/* Refresh button */}
          <button
            onClick={fetchRecipes}
            disabled={isRecipesLoading}
            className="w-8 h-8 rounded-lg border border-surface-border/50 flex items-center justify-center
                       text-text-tertiary hover:text-text-primary hover:border-surface-border
                       disabled:opacity-40 transition-all"
          >
            <RefreshCw size={13} className={isRecipesLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <FilterTabs active={filter} onChange={setFilter} />

      {/* 3D hint */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2/60 border border-surface-border/30 flex-shrink-0">
        <Sparkles size={11} className="text-health-ok flex-shrink-0" />
        <p className="font-mono text-2xs text-text-tertiary leading-snug">
          Survolez une recette pour voir les ingrédients disponibles s'illuminer dans le frigo 3D.
        </p>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-0.5">
        {/* Loading state */}
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

        {/* Error state */}
        {recipesError && (
          <div className="flex items-center gap-2 p-3 rounded-lg
                          bg-health-critical/5 border border-health-critical/25">
            <AlertCircle size={14} className="text-health-critical flex-shrink-0" />
            <div className="flex-1">
              <span className="font-mono text-xs text-health-critical">{recipesError}</span>
              <button
                onClick={fetchRecipes}
                className="block font-mono text-2xs text-accent mt-1 hover:text-accent-bright"
              >
                Réessayer →
              </button>
            </div>
          </div>
        )}

        {/* Empty state after filter */}
        {!isRecipesLoading && filteredRecipes.length === 0 && recipeSuggestions.length > 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <ChefHat size={28} className="text-text-tertiary/40" />
            <div className="text-center">
              <div className="font-mono text-sm text-text-tertiary">AUCUNE RECETTE</div>
              <div className="font-body text-xs text-text-tertiary/60 mt-1">
                {filter === 'ready' ? 'Aucune recette réalisable avec le stock actuel' : filter === 'protein' ? `Aucune recette à plus de ${PROTEIN_THRESHOLD_G} g de protéines par portion` : 'Aucune recette rapide disponible'}
              </div>
              <button onClick={() => setFilter('all')} className="font-mono text-2xs text-accent mt-2 hover:text-accent-bright">
                Voir toutes les suggestions →
              </button>
            </div>
          </div>
        )}

        {/* Recipe grid */}
        {filteredRecipes.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            <AnimatePresence mode="popLayout">
              {filteredRecipes.map((recipe, i) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  index={i}
                  isFavorite={favorites.has(recipe.id)}
                  isPinned={pinnedId === recipe.id}
                  onToggleFavorite={handleToggleFavorite}
                  onTogglePin={handleTogglePin}
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
            {filteredRecipes.length} / {recipeSuggestions.length} recettes
          </span>
          <div className="flex items-center gap-1.5">
            <Star size={10} className="text-amber-400" />
            <span className="font-mono text-2xs text-text-tertiary">
              {favorites.size} favori{favorites.size !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}