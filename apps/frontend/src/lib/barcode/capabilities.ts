// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Sondage des capacités du détecteur natif (`window.BarcodeDetector`)
//
// `BarcodeDetector` (Barcode Detection API) n'est pas typé par lib.dom et son
// support est très inégal :
//   • Chrome/Android : présent, formats 1D (ean_13…) réellement décodés.
//   • Safari iOS     : absent, ou présent mais sans les formats 1D — et dans ce
//                      cas `detect()` renvoie systématiquement un tableau vide.
//
// `html5-qrcode` se contente de tester `"BarcodeDetector" in window` : sur iOS
// il peut donc sélectionner un décodeur natif qui ne décode jamais rien, sans
// jamais lever d'erreur. On sonde ici les formats *réellement* annoncés et on
// n'active le moteur natif que si `ean_13` en fait partie.
// ─────────────────────────────────────────────────────────────────────────────

import { describeError, withTimeout } from './utils'

/** Formats 1D attendus pour la lecture de produits (ordre = priorité). */
export const EAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const

export type EanFormat = (typeof EAN_FORMATS)[number]

/** Résultat minimal d'une détection (sous-ensemble de l'API standard). */
export interface NativeBarcodeResult {
  rawValue: string
  format: string
}

/** Sous-ensemble de `BarcodeDetector` réellement utilisé par le scanner. */
export interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<NativeBarcodeResult[]>
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

export interface NativeDetectorProbe {
  /** `window.BarcodeDetector` est exposé par le navigateur. */
  present: boolean
  /** Les formats 1D requis sont réellement supportés → moteur natif utilisable. */
  usable: boolean
  /** Formats 1D annoncés par l'implémentation (intersection avec EAN_FORMATS). */
  usableFormats: string[]
  /** Liste brute renvoyée par `getSupportedFormats()` (diagnostic). */
  supportedFormats: string[]
  /** Raison du refus du moteur natif, `null` si tout est OK. */
  error: string | null
}

const PROBE_TIMEOUT_MS = 1000

export function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector
  return typeof ctor === 'function' ? (ctor as BarcodeDetectorCtor) : null
}

function unsupportedProbe(present: boolean, error: string): NativeDetectorProbe {
  return { present, usable: false, usableFormats: [], supportedFormats: [], error }
}

/**
 * Vérifie si le détecteur natif existe **et** s'il sait décoder de l'EAN-13.
 *
 * Ne lève jamais : toutes les erreurs (API absente, `getSupportedFormats`
 * rejetée, promesse qui ne se résout jamais sur iOS) aboutissent à
 * `usable: false` avec la raison dans `error`.
 */
export async function probeNativeBarcodeDetector(): Promise<NativeDetectorProbe> {
  const ctor = getBarcodeDetectorCtor()
  if (!ctor) return unsupportedProbe(false, 'window.BarcodeDetector absent')

  // `getSupportedFormats` est une méthode statique : on accepte aussi le cas
  // où elle n'est exposée que sur le prototype (implémentations non standard).
  const staticGetter = ctor.getSupportedFormats
  const protoGetter = (ctor as unknown as {
    prototype?: { getSupportedFormats?: () => Promise<string[]> }
  }).prototype?.getSupportedFormats
  const getter = staticGetter ?? protoGetter

  if (typeof getter !== 'function') {
    return unsupportedProbe(true, 'getSupportedFormats() indisponible → natif non fiable')
  }

  try {
    const formats = await withTimeout(
      Promise.resolve(getter.call(ctor)),
      PROBE_TIMEOUT_MS,
      'BarcodeDetector.getSupportedFormats()',
    )
    const supportedFormats = Array.isArray(formats) ? formats : []
    const usableFormats = EAN_FORMATS.filter((format) => supportedFormats.includes(format))

    if (!usableFormats.includes('ean_13')) {
      return {
        present: true,
        usable: false,
        usableFormats,
        supportedFormats,
        error: `ean_13 absent de getSupportedFormats() [${
          supportedFormats.join(', ') || 'aucun format'
        }]`,
      }
    }
    return { present: true, usable: true, usableFormats, supportedFormats, error: null }
  } catch (error) {
    return {
      present: true,
      usable: false,
      usableFormats: [],
      supportedFormats: [],
      error: `getSupportedFormats() a échoué : ${describeError(error)}`,
    }
  }
}

/**
 * Instancie un détecteur natif pour les formats 1D disponibles.
 * Retourne `null` si l'API refuse la configuration.
 */
export function createNativeDetector(formats: string[]): NativeBarcodeDetector | null {
  const ctor = getBarcodeDetectorCtor()
  if (!ctor) return null
  const requested = formats.filter((format) => (EAN_FORMATS as readonly string[]).includes(format))
  if (requested.length === 0) return null
  try {
    return new ctor({ formats: requested })
  } catch {
    return null
  }
}