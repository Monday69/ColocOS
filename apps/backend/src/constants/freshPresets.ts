/**
 * Catalogue d'aliments frais vendus sans code-barres (boucherie, poissonnerie,
 * primeur, boulangerie, vrac).
 *
 * Chaque preset porte les durées de conservation **sanitaires** usuelles
 * (règles de bon sens grand public, pas un avis médical) et la zone de
 * rangement recommandée, exprimée par `meshId` de `StorageZone`.
 *
 * Les macros sont indicatives pour 100 g / 100 ml (source : tables Ciqual/USDA
 * arrondies) et servent à alimenter la fiche nutrition du packaging.
 */

export type FreshCategoryId = 'butcher' | 'produce' | 'bakery';

export interface FreshCategory {
  id: FreshCategoryId;
  label: string;
  emoji: string;
}

export const FRESH_CATEGORIES: FreshCategory[] = [
  { id: 'butcher', label: 'Boucherie', emoji: '🥩' },
  { id: 'produce', label: 'Primeur', emoji: '🥦' },
  { id: 'bakery', label: 'Boulangerie', emoji: '🥖' },
];

export interface FreshPreset {
  id: string;
  name: string;
  category: FreshCategoryId;
  emoji: string;
  /** Durée de conservation sanitaire, en jours, à partir de l'achat */
  shelfLifeDays: number;
  /** Zone de rangement recommandée (meshId de StorageZone) */
  zoneMeshId: string;
  /** Libellé lisible de la zone (affiché dans la tuile / la fiche) */
  zoneLabel: string;
  unit: 'unit' | 'g' | 'kg' | 'ml' | 'L';
  /** Quantité proposée par défaut */
  defaultQty: number;
  /** Macros pour 100 g / 100 ml */
  calories: number | null;
  proteins: number | null;
  /** Mots-clés de recherche libre (pluriels, synonymes) */
  keywords: string[];
}

export const FRESH_PRESETS: FreshPreset[] = [
  // ── Boucherie / Poissonnerie ───────────────────────────────────────────────
  {
    id: 'steak-hache',
    name: 'Steak haché frais',
    category: 'butcher',
    emoji: '🥩',
    shelfLifeDays: 2,
    zoneMeshId: 'fridge_shelf_bottom',
    zoneLabel: 'Étagère basse',
    unit: 'unit',
    defaultQty: 1,
    calories: 250,
    proteins: 20,
    keywords: ['steak', 'haché', 'hache', 'boeuf', 'viande', 'steaks'],
  },
  {
    id: 'filet-poulet',
    name: 'Filet de poulet',
    category: 'butcher',
    emoji: '🍗',
    shelfLifeDays: 3,
    zoneMeshId: 'fridge_shelf_bottom',
    zoneLabel: 'Étagère basse',
    unit: 'g',
    defaultQty: 300,
    calories: 120,
    proteins: 26,
    keywords: ['poulet', 'filet', 'fillet', 'volaille', 'blanc'],
  },
  {
    id: 'pave-saumon',
    name: 'Pavé de saumon',
    category: 'butcher',
    emoji: '🐟',
    shelfLifeDays: 2,
    zoneMeshId: 'fridge_shelf_bottom',
    zoneLabel: 'Étagère basse',
    unit: 'unit',
    defaultQty: 1,
    calories: 208,
    proteins: 20,
    keywords: ['saumon', 'poisson', 'pavé', 'pave', 'salmons'],
  },
  {
    id: 'jambon-blanc',
    name: 'Jambon blanc',
    category: 'butcher',
    emoji: '🥓',
    shelfLifeDays: 4,
    zoneMeshId: 'fridge_shelf_middle',
    zoneLabel: 'Étagère milieu',
    unit: 'unit',
    defaultQty: 1,
    calories: 110,
    proteins: 21,
    keywords: ['jambon', 'blanc', 'charcuterie', 'tranches'],
  },

  // ── Primeur / Marché ──────────────────────────────────────────────────────
  {
    id: 'tomates',
    name: 'Tomates',
    category: 'produce',
    emoji: '🍅',
    shelfLifeDays: 7,
    zoneMeshId: 'fridge_crisper_left',
    zoneLabel: 'Bac à légumes',
    unit: 'unit',
    defaultQty: 4,
    calories: 18,
    proteins: 0.9,
    keywords: ['tomate', 'tomates', 'grappe', 'cerise'],
  },
  {
    id: 'courgettes',
    name: 'Courgettes',
    category: 'produce',
    emoji: '🥒',
    shelfLifeDays: 7,
    zoneMeshId: 'fridge_crisper_left',
    zoneLabel: 'Bac à légumes',
    unit: 'unit',
    defaultQty: 2,
    calories: 17,
    proteins: 1.2,
    keywords: ['courgette', 'courgettes', 'zucchini', 'légume', 'legume'],
  },
  {
    id: 'avocat',
    name: 'Avocat',
    category: 'produce',
    emoji: '🥑',
    shelfLifeDays: 5,
    zoneMeshId: 'fridge_crisper_left',
    zoneLabel: 'Bac à légumes',
    unit: 'unit',
    defaultQty: 2,
    calories: 160,
    proteins: 2,
    keywords: ['avocat', 'avocats', 'hass'],
  },
  {
    id: 'pommes',
    name: 'Pommes',
    category: 'produce',
    emoji: '🍎',
    shelfLifeDays: 14,
    zoneMeshId: 'fridge_crisper_right',
    zoneLabel: 'Bac à légumes',
    unit: 'unit',
    defaultQty: 4,
    calories: 52,
    proteins: 0.3,
    keywords: ['pomme', 'pommes', 'fruit', 'gala', 'golden'],
  },
  {
    id: 'salade',
    name: 'Salade / Mâche',
    category: 'produce',
    emoji: '🥬',
    shelfLifeDays: 4,
    zoneMeshId: 'fridge_crisper_left',
    zoneLabel: 'Bac à légumes',
    unit: 'unit',
    defaultQty: 1,
    calories: 15,
    proteins: 1.4,
    keywords: ['salade', 'mâche', 'mache', 'laitue', 'roquette', 'jeunes pousses'],
  },

  // ── Boulangerie & Quotidien ───────────────────────────────────────────────
  {
    id: 'pain',
    name: 'Baguette / Pain',
    category: 'bakery',
    emoji: '🥖',
    shelfLifeDays: 2,
    zoneMeshId: 'pantry_shelf_1',
    zoneLabel: 'Garde-manger',
    unit: 'unit',
    defaultQty: 1,
    calories: 265,
    proteins: 9,
    keywords: ['pain', 'baguette', 'tradition', 'campagne', 'boule'],
  },
  {
    id: 'oeufs',
    name: 'Œufs frais',
    category: 'bakery',
    emoji: '🥚',
    shelfLifeDays: 21,
    zoneMeshId: 'fridge_shelf_top',
    zoneLabel: 'Étagère haute',
    unit: 'unit',
    defaultQty: 6,
    calories: 155,
    proteins: 13,
    keywords: ['oeuf', 'oeufs', 'œuf', 'œufs', 'egg', 'plein air'],
  },
  {
    id: 'fromage-coupe',
    name: 'Fromage à la coupe',
    category: 'bakery',
    emoji: '🧀',
    shelfLifeDays: 10,
    zoneMeshId: 'fridge_shelf_middle',
    zoneLabel: 'Étagère milieu',
    unit: 'g',
    defaultQty: 200,
    calories: 350,
    proteins: 25,
    keywords: ['fromage', 'coupe', 'comté', 'comte', 'brie', 'chèvre', 'chevre'],
  },
];

/** Retrouve un preset par identifiant. */
export function findPreset(presetId: string): FreshPreset | undefined {
  return FRESH_PRESETS.find((preset) => preset.id === presetId);
}

/**
 * Recherche libre : la requête est comparée au nom et aux mots-clés, avec un
 * score simple (début de mot > inclusion) pour que « courgette » trouve
 * « Courgettes » et « 2 pavés de saumon » trouve le pavé de saumon.
 */
export function searchPresets(query: string): FreshPreset[] {
  const needle = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (!needle) return FRESH_PRESETS;

  const scored = FRESH_PRESETS.map((preset) => {
    const haystacks = [preset.name, ...preset.keywords].map((value) =>
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''),
    );

    let score = 0;
    for (const haystack of haystacks) {
      if (haystack === needle) score = Math.max(score, 100);
      else if (haystack.startsWith(needle)) score = Math.max(score, 80);
      else if (haystack.includes(needle)) score = Math.max(score, 50);
      else if (needle.includes(haystack) && haystack.length >= 4) score = Math.max(score, 30);
    }
    return { preset, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((entry) => entry.preset);
}
