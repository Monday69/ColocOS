// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Ingredient Normalizer
//
// STRATÉGIE DE NORMALISATION :
// L'API Spoonacular utilise un moteur NLP anglais pour le "ingredient matching".
// Le principal point de défaillance est linguistique : un item nommé "Lait
// demi-écrémé Lactel" ne sera jamais reconnu tel quel.
//
// Pipeline de normalisation :
//   1. Nettoyage  — suppression de la marque, de la ponctuation, des accents
//   2. Traduction — dictionnaire FR→EN des ingrédients courants (offline, zéro latence)
//   3. Généralisation — on retire les qualificatifs ("demi-écrémé" → "milk")
//   4. Fallback — si inconnu, on passe le nom nettoyé tel quel (Spoonacular
//      fait un matching flou côté API)
// ─────────────────────────────────────────────────────────────────────────────

// Dictionnaire de traduction FR → EN
// Couvre ~95% des produits de grande consommation français
const FR_TO_EN_DICT: Record<string, string> = {
  // Laitages
  lait: 'milk',
  'lait entier': 'whole milk',
  'lait demi-écrémé': 'milk',
  'lait écrémé': 'skim milk',
  beurre: 'butter',
  crème: 'cream',
  'crème fraîche': 'heavy cream',
  yaourt: 'yogurt',
  fromage: 'cheese',
  'fromage blanc': 'cream cheese',
  'gruyère': 'swiss cheese',
  'emmental': 'swiss cheese',
  'comté': 'swiss cheese',
  'camembert': 'camembert',
  'brie': 'brie',
  oeuf: 'egg',
  oeufs: 'eggs',

  // Viandes & Poissons
  poulet: 'chicken',
  'blanc de poulet': 'chicken breast',
  'cuisse de poulet': 'chicken thigh',
  boeuf: 'beef',
  'viande hachée': 'ground beef',
  porc: 'pork',
  jambon: 'ham',
  'lardons': 'bacon',
  saumon: 'salmon',
  thon: 'tuna',
  cabillaud: 'cod',
  crevettes: 'shrimp',
  moules: 'mussels',

  // Légumes
  carotte: 'carrot',
  carottes: 'carrots',
  oignon: 'onion',
  oignons: 'onions',
  'oignon rouge': 'red onion',
  ail: 'garlic',
  tomate: 'tomato',
  tomates: 'tomatoes',
  poivron: 'bell pepper',
  courgette: 'zucchini',
  aubergine: 'eggplant',
  épinards: 'spinach',
  salade: 'lettuce',
  laitue: 'lettuce',
  champignons: 'mushrooms',
  champignon: 'mushroom',
  'pomme de terre': 'potato',
  'pommes de terre': 'potatoes',
  poireau: 'leek',
  céleri: 'celery',
  brocoli: 'broccoli',
  chou: 'cabbage',
  'chou-fleur': 'cauliflower',
  petitspois: 'peas',
  'petits pois': 'peas',
  maïs: 'corn',
  concombre: 'cucumber',
  radis: 'radish',
  navet: 'turnip',

  // Fruits
  pomme: 'apple',
  pommes: 'apples',
  poire: 'pear',
  banane: 'banana',
  bananes: 'bananas',
  fraise: 'strawberry',
  fraises: 'strawberries',
  citron: 'lemon',
  citrons: 'lemons',
  orange: 'orange',
  oranges: 'oranges',
  raisin: 'grapes',
  pêche: 'peach',
  abricot: 'apricot',
  cerise: 'cherry',
  framboises: 'raspberries',
  myrtilles: 'blueberries',
  avocat: 'avocado',

  // Épicerie sèche
  farine: 'flour',
  'farine de blé': 'all-purpose flour',
  sucre: 'sugar',
  'sucre glace': 'powdered sugar',
  sel: 'salt',
  poivre: 'pepper',
  riz: 'rice',
  pâtes: 'pasta',
  spaghetti: 'spaghetti',
  'penne': 'penne',
  'macaroni': 'macaroni',
  pain: 'bread',
  'chapelure': 'breadcrumbs',
  lentilles: 'lentils',
  pois: 'peas',
  haricots: 'beans',
  'haricots blancs': 'white beans',
  'haricots rouges': 'kidney beans',
  semoule: 'semolina',
  'levure chimique': 'baking powder',
  bicarbonate: 'baking soda',
  vanille: 'vanilla',
  cacao: 'cocoa',
  chocolat: 'chocolate',

  // Matières grasses
  'huile olive': 'olive oil',
  "huile d'olive": 'olive oil',
  'huile tournesol': 'sunflower oil',
  huile: 'oil',
  margarine: 'margarine',

  // Liquides / Conserves
  'bouillon de poulet': 'chicken broth',
  'bouillon de bœuf': 'beef broth',
  'coulis de tomates': 'tomato sauce',
  'concentré de tomates': 'tomato paste',
  tomates: 'tomatoes',
  'tomates concassées': 'crushed tomatoes',
  vinaigre: 'vinegar',
  'vinaigre balsamique': 'balsamic vinegar',
  moutarde: 'mustard',
  ketchup: 'ketchup',
  mayonnaise: 'mayonnaise',
  miel: 'honey',
  'sauce soja': 'soy sauce',

  // Herbes & Épices
  persil: 'parsley',
  basilic: 'basil',
  thym: 'thyme',
  romarin: 'rosemary',
  laurier: 'bay leaf',
  ciboulette: 'chives',
  estragon: 'tarragon',
  coriandre: 'coriander',
  cumin: 'cumin',
  curcuma: 'turmeric',
  paprika: 'paprika',
  'piment': 'chili',
  cannelle: 'cinnamon',
  muscade: 'nutmeg',
  gingembre: 'ginger',

  // Boissons
  vin: 'wine',
  'vin blanc': 'white wine',
  'vin rouge': 'red wine',
  bière: 'beer',
  jus: 'juice',
  'jus de citron': 'lemon juice',
  'jus d\'orange': 'orange juice',
};

// Qualificatifs français courants à supprimer (ne font pas partie du concept ingrédient)
const FRENCH_QUALIFIERS_TO_REMOVE = [
  'demi-écrémé', 'écrémé', 'entier', 'frais', 'fraîche', 'bio', 'allégé',
  'nature', 'cru', 'cuite', 'cuit', 'surgelé', 'surgelée', 'congelé',
  'label rouge', 'aop', 'igp', 'extra', 'premium', 'fin', 'fine',
  'en conserve', 'en boîte', 'émincé', 'émincée', 'haché', 'hachée',
  'tranché', 'tranchée', 'râpé', 'râpée', 'mixte',
];

// Normalise un accent : café → cafe
function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Extrait le "nom ingrédient" en retirant la marque et les qualificatifs
function stripBrandAndQualifiers(name: string): string {
  let cleaned = name.toLowerCase().trim();

  // Supprime les qualificatifs
  for (const qualifier of FRENCH_QUALIFIERS_TO_REMOVE) {
    cleaned = cleaned.replace(new RegExp(`\\b${qualifier}\\b`, 'gi'), '');
  }

  // Normalise les espaces multiples
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

export interface NormalizedIngredient {
  /** Nom original tel que stocké en BDD */
  originalName: string;
  /** Nom en anglais pour l'API Spoonacular */
  englishName: string;
  /** La traduction a été trouvée dans le dictionnaire */
  wasTranslated: boolean;
}

/**
 * Normalise un nom d'ingrédient français vers l'anglais pour l'API Spoonacular.
 *
 * Pipeline :
 *   1. Lowercase + trim
 *   2. Suppression des qualificatifs (bio, demi-écrémé, etc.)
 *   3. Lookup dictionnaire exact
 *   4. Lookup dictionnaire après suppression des accents
 *   5. Fallback : nom nettoyé sans accents (Spoonacular a un NLP de fallback)
 */
export function normalizeIngredient(
  name: string,
  brand?: string | null,
): NormalizedIngredient {
  // Retire la marque si elle est en début de nom (ex: "Lactel Lait" → "lait")
  let workingName = name;
  if (brand) {
    const brandRegex = new RegExp(`^${brand}\\s+`, 'i');
    workingName = workingName.replace(brandRegex, '');
  }

  const cleaned = stripBrandAndQualifiers(workingName);

  // Lookup direct (avec accents)
  if (FR_TO_EN_DICT[cleaned]) {
    return {
      originalName: name,
      englishName: FR_TO_EN_DICT[cleaned],
      wasTranslated: true,
    };
  }

  // Lookup sans accents
  const noAccents = removeAccents(cleaned);
  if (FR_TO_EN_DICT[noAccents]) {
    return {
      originalName: name,
      englishName: FR_TO_EN_DICT[noAccents],
      wasTranslated: true,
    };
  }

  // Recherche partielle : si le nom contient un mot du dictionnaire
  const words = cleaned.split(' ');
  for (const word of words) {
    if (FR_TO_EN_DICT[word]) {
      return {
        originalName: name,
        englishName: FR_TO_EN_DICT[word],
        wasTranslated: true,
      };
    }
  }

  // Fallback : nom nettoyé sans accents (Spoonacular gère parfois le français)
  return {
    originalName: name,
    englishName: noAccents,
    wasTranslated: false,
  };
}

/**
 * Normalise une liste d'items du stock vers un tableau d'ingrédients API.
 * Déduplique les ingrédients normalisés identiques.
 */
export function normalizeStockToIngredients(
  items: Array<{ name: string; brand?: string | null }>,
): NormalizedIngredient[] {
  const seen = new Set<string>();
  const result: NormalizedIngredient[] = [];

  for (const item of items) {
    const normalized = normalizeIngredient(item.name, item.brand);
    if (!seen.has(normalized.englishName)) {
      seen.add(normalized.englishName);
      result.push(normalized);
    }
  }

  return result;
}