import * as cheerio from 'cheerio';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Recipe Scraper (Schema.org / JSON-LD)
//
// Importe une recette depuis une page web (Marmiton, 750g, CuisineAZ, blogs…)
// en lisant les données structurées `application/ld+json` plutôt qu'en devinant
// le HTML : c'est le seul contrat stable entre les sites.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScrapedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface ScrapedRecipe {
  title: string;
  sourceUrl: string;
  imageUrl: string | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number;
  ingredients: ScrapedIngredient[];
  instructions: string[];
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 3_000_000;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
  'Cache-Control': 'no-cache',
};

// ── Normalisation des unités ─────────────────────────────────────────────────

/** Unités reconnues → forme canonique courte (`g`, `ml`, `c. à s.`…). */
const UNIT_ALIASES: Array<{ match: RegExp; unit: string }> = [
  { match: /^(kilogrammes?|kilos?|kgs?)$/i, unit: 'kg' },
  { match: /^(grammes?|grs?|g)$/i, unit: 'g' },
  { match: /^(millilitres?|mls?|ml|cl)?$/i, unit: 'ml' },
  { match: /^(centilitres?|cls?|cl)$/i, unit: 'cl' },
  { match: /^(litres?|l)$/i, unit: 'L' },
  { match: /^(cuill[èe]res?\s*(à|a)\s*soupe|cas|c\.?\s*à\.?\s*s\.?)$/i, unit: 'c. à s.' },
  { match: /^(cuill[èe]res?\s*(à|a)\s*caf[ée]|cac|c\.?\s*à\.?\s*c\.?)$/i, unit: 'c. à c.' },
  { match: /^(pinc[ée]es?)$/i, unit: 'pincée' },
  { match: /^(sachets?)$/i, unit: 'sachet' },
  { match: /^(paquets?)$/i, unit: 'paquet' },
  { match: /^(bo[îi]tes?)$/i, unit: 'boîte' },
  { match: /^(tranches?)$/i, unit: 'tranche' },
  { match: /^(gousses?)$/i, unit: 'gousse' },
  { match: /^(branches?|brins?)$/i, unit: 'branche' },
  { match: /^(verres?)$/i, unit: 'verre' },
  { match: /^(tasses?)$/i, unit: 'tasse' },
  { match: /^(boules?)$/i, unit: 'boule' },
  { match: /^(portions?)$/i, unit: 'portion' },
  { match: /^(pi[èe]ces?)$/i, unit: 'pièce' },
];

function canonicalUnit(raw: string): string | null {
  const value = raw.trim().replace(/\.$/, '');
  if (!value) return null;
  for (const alias of UNIT_ALIASES) {
    if (alias.match.test(value)) return alias.unit;
  }
  return null;
}

/** « 1/2 », « 1,5 », « 200 » → nombre ; `null` si absent. */
function parseQuantity(raw: string): number | null {
  const value = raw.trim().replace(',', '.');
  if (!value) return null;

  const fraction = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator > 0) return Math.round((numerator / denominator) * 100) / 100;
  }

  const mixed = value.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    if (denominator > 0) {
      return Math.round((whole + numerator / denominator) * 100) / 100;
    }
  }

  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * « 200 g de lardons fumés » → { quantity: 200, unit: 'g', name: 'lardons fumés' }
 * « 4 œufs frais »           → { quantity: 4, unit: null, name: 'œufs frais' }
 * « Sel et poivre »          → { quantity: null, unit: null, name: 'Sel et poivre' }
 */
export function parseIngredientLine(line: string): ScrapedIngredient {
  const cleaned = line
    .replace(/\s+/g, ' ')
    .replace(/^[-–•·*]\s*/, '')
    .trim();

  // Quantité en tête : « 200 », « 1/2 », « 1,5 », « 2 x 125 »
  const head = cleaned.match(
    /^((?:\d+\s+\d+\s*\/\s*\d+)|(?:\d+\s*\/\s*\d+)|(?:\d+(?:[.,]\d+)?))\s*(.*)$/,
  );

  if (!head) {
    return { quantity: null, unit: null, name: cleaned };
  }

  const quantity = parseQuantity(head[1]);
  let rest = head[2].trim();

  // « 2 x 125 g » : on garde la quantité totale (2 × 125 = 250)
  const multiplier = rest.match(/^[x×]\s*((?:\d+(?:[.,]\d+)?))\s*(.*)$/i);
  if (multiplier && quantity !== null) {
    const factor = parseQuantity(multiplier[1]);
    if (factor !== null) rest = multiplier[2].trim();
  }

  // Unité éventuelle juste après la quantité
  const unitMatch = rest.match(
    /^((?:c\.?\s*à\.?\s*s\.?|c\.?\s*à\.?\s*c\.?|cuill[èe]res?\s*(?:à|a)\s*[a-zéè]+)|[a-zA-Zéèêàûôîïç.]+)\.?\s+(.*)$/,
  );

  let unit: string | null = null;
  let name = rest;

  if (unitMatch) {
    const candidate = canonicalUnit(unitMatch[1]);
    if (candidate) {
      unit = candidate;
      name = unitMatch[2].trim();
    } else {
      // Unité inconnue mais mot court (ex. « 2 pommes ») → le mot appartient au nom
      const word = unitMatch[1].toLowerCase();
      if (word.length <= 3 && !/^[a-zé]{4,}$/.test(word)) {
        unit = unitMatch[1];
        name = unitMatch[2].trim();
      }
    }
  }

  // Nettoyage des prépositions résiduelles : « g de lardons » → « lardons »
  name = name
    .replace(/^(de|d'|du|des|la|le|les)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) name = cleaned;

  return {
    quantity: quantity === null ? null : Math.round(quantity * 100) / 100,
    unit,
    name,
  };
}

// ── Durées ISO 8601 ──────────────────────────────────────────────────────────

/** « PT15M » → 15 ; « PT1H10M » → 70 ; « P0DT1H » → 60 ; invalide → null. */
export function parseIsoDuration(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const match = raw
    .trim()
    .toUpperCase()
    .match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);

  if (!match) return null;

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);

  const total = days * 1440 + hours * 60 + minutes + seconds / 60;
  return total > 0 ? Math.round(total) : 0;
}

/** « 4 personnes » / 4 / ["4"] → 4. Défaut : 4. */
function parseServings(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.min(50, Math.round(value));
  }
  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    if (match) {
      const parsed = Number.parseInt(match[0], 10);
      if (parsed > 0 && parsed <= 50) return parsed;
    }
  }
  return 4;
}

/** image : string | string[] | { url } | { url: string[] }. */
function pickImage(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const found = pickImage(entry);
      if (found) return found;
    }
    return null;
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if ('url' in record) return pickImage(record.url);
    if ('contentUrl' in record) return pickImage(record.contentUrl);
  }
  return null;
}

/** Instructions : string | string[] | HowToStep | HowToSection (imbriqué). */
function collectInstructions(raw: unknown, out: string[] = []): string[] {
  if (raw === null || raw === undefined) return out;

  if (typeof raw === 'string') {
    // Certains sites collent plusieurs étapes séparées par des retours à la ligne
    raw
      .split(/\r?\n+/)
      .map((step) => step.trim())
      .filter((step) => step.length > 0)
      .forEach((step) => out.push(step));
    return out;
  }

  if (Array.isArray(raw)) {
    raw.forEach((entry) => collectInstructions(entry, out));
    return out;
  }

  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const type = Array.isArray(record['@type']) ? record['@type'][0] : record['@type'];

    if (type === 'HowToSection' || 'itemListElement' in record) {
      if (record.itemListElement) collectInstructions(record.itemListElement, out);
      return out;
    }
    if (typeof record.text === 'string' && record.text.trim()) {
      out.push(record.text.trim());
    }
    return out;
  }

  return out;
}

/** Élimine les balises HTML résiduelles (« <p>Faites revenir…</p> »). */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Extraction JSON-LD ───────────────────────────────────────────────────────

type LdNode = Record<string, unknown>;

function isRecipeNode(node: unknown): node is LdNode {
  if (!node || typeof node !== 'object') return false;
  const type = (node as LdNode)['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (entry) => typeof entry === 'string' && entry.toLowerCase() === 'recipe',
  );
}

/** Cherche un nœud Recipe, y compris dans `@graph` ou un tableau de nœuds. */
function findRecipeNode(node: unknown, depth = 0): LdNode | null {
  if (!node || depth > 6) return null;

  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findRecipeNode(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;

  if (isRecipeNode(node)) return node as LdNode;

  const record = node as LdNode;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    if (key in record) {
      const found = findRecipeNode(record[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/** Accepte `application/ld+json` et les variantes `ld+json;charset=utf-8`. */
function isJsonLdScript(typeAttr: string | undefined): boolean {
  if (!typeAttr) return false;
  return /application\/ld\+json/i.test(typeAttr);
}

// ── Service ─────────────────────────────────────────────────────────────────

export class RecipeScraperService {
  /**
   * Récupère une recette depuis une URL et renvoie sa forme normalisée.
   * Erreurs : 400 (URL invalide), 422 (pas de JSON-LD Recipe), 502 (site KO).
   */
  async scrapeRecipeFromUrl(rawUrl: string): Promise<ScrapedRecipe> {
    const url = this.validateUrl(rawUrl);

    let html: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: controller.signal,
        redirect: 'follow',
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        throw new AppError(
          502,
          `Le site a répondu ${response.status} — impossible de lire la recette.`,
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
        throw new AppError(422, "Cette URL ne renvoie pas une page HTML.");
      }

      html = await response.text();
      if (html.length > MAX_HTML_BYTES) {
        html = html.slice(0, MAX_HTML_BYTES);
        logger.warn(`[Scraper] Page tronquée à ${MAX_HTML_BYTES} octets : ${url}`);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppError(504, 'Le site met trop de temps à répondre (12 s).');
      }
      throw new AppError(
        502,
        `Impossible de récupérer la page : ${err instanceof Error ? err.message : 'erreur réseau'}`,
      );
    }

    const $ = cheerio.load(html);
    const candidates: LdNode[] = [];

    $('script[type]').each((_index, element) => {
      const typeAttr = $(element).attr('type');
      if (!isJsonLdScript(typeAttr)) return;

      const raw = $(element).contents().text().trim();
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        const recipe = findRecipeNode(parsed);
        if (recipe) candidates.push(recipe);
      } catch {
        // JSON-LD malformé : fréquent, on ignore ce bloc
      }
    });

    const node = this.pickBestNode(candidates, $);
    if (!node) {
      throw new AppError(
        422,
        'Aucune recette structurée (JSON-LD Schema.org) trouvée sur cette page. ' +
          "Copiez-collez les ingrédients manuellement, ou essayez une autre URL.",
      );
    }

    const title = stripHtml(
      String(node.name ?? node.headline ?? '').toString() || 'Recette importée',
    );
    if (!title) {
      throw new AppError(422, "La recette trouvée n'a pas de titre exploitable.");
    }

    const rawIngredients = Array.isArray(node.recipeIngredient)
      ? node.recipeIngredient
      : typeof node.recipeIngredient === 'string'
        ? [node.recipeIngredient]
        : [];

    const ingredients: ScrapedIngredient[] = rawIngredients
      .map((entry) => stripHtml(String(entry ?? '')))
      .filter((line) => line.length > 0)
      .map(parseIngredientLine);

    if (ingredients.length === 0) {
      throw new AppError(422, "La recette ne contient aucun ingrédient exploitable.");
    }

    const instructions = collectInstructions(node.recipeInstructions)
      .map(stripHtml)
      .filter((step) => step.length > 2)
      .slice(0, 60);

    const prepTimeMin = parseIsoDuration(node.prepTime);
    const cookTimeMin = parseIsoDuration(node.cookTime);
    const totalTime = parseIsoDuration(node.totalTime);

    const scraped: ScrapedRecipe = {
      title: title.slice(0, 200),
      sourceUrl: url,
      imageUrl: pickImage(node.image)?.slice(0, 500) ?? null,
      // Si seul `totalTime` existe, on l'attribue à la préparation
      prepTimeMin: prepTimeMin ?? (cookTimeMin === null ? totalTime : null),
      cookTimeMin,
      servings: parseServings(node.recipeYield),
      ingredients: ingredients.slice(0, 80),
      instructions,
    };

    logger.info(
      `[Scraper] ${scraped.title} — ${scraped.ingredients.length} ingrédients, ${scraped.instructions.length} étapes (${url})`,
    );

    return scraped;
  }

  /**
   * Une page contient souvent plusieurs nœuds Recipe (recettes liées, carrousels).
   * On garde celui dont le titre ressemble le plus au titre de la page
   * (`og:title`, `h1`, `<title>`), sinon le premier trouvé.
   */
  private pickBestNode(
    candidates: LdNode[],
    $: ReturnType<typeof cheerio.load>,
  ): LdNode | undefined {
    if (candidates.length <= 1) return candidates[0];

    const pageTitle = [
      $('meta[property="og:title"]').attr('content') ?? '',
      $('h1').first().text() ?? '',
      $('title').text() ?? '',
    ]
      .join(' ')
      .toLowerCase();

    if (!pageTitle.trim()) return candidates[0];

    const pageWords = new Set(
      pageTitle
        .replace(/[^a-zà-ÿ0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 3),
    );

    let best = candidates[0];
    let bestScore = -1;

    for (const candidate of candidates) {
      const title = String(candidate.name ?? candidate.headline ?? '').toLowerCase();
      if (!title) continue;

      const words = title
        .replace(/[^a-zà-ÿ0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 3);

      const score = words.reduce((total, word) => (pageWords.has(word) ? total + 1 : total), 0);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  /** URL http(s) valide, sans identifiants ni schéma exotique. */
  private validateUrl(rawUrl: string): string {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      throw new AppError(400, 'URL requise.');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new AppError(400, 'URL invalide (exemple : https://www.marmiton.org/recettes/…).');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new AppError(400, 'Seules les URL http(s) sont acceptées.');
    }
    if (parsed.username || parsed.password) {
      throw new AppError(400, 'Les URL contenant des identifiants sont refusées.');
    }
    // Refus des hôtes internes (SSRF basique)
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.local') ||
      host === '169.254.169.254'
    ) {
      throw new AppError(400, 'Cette adresse réseau interne ne peut pas être importée.');
    }

    return parsed.toString();
  }
}

export const recipeScraperService = new RecipeScraperService();
