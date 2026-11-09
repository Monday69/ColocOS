// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Décodeur ZXing (pur JS) pour les codes 1D
//
// Moteur de repli universel : c'est le seul décodeur EAN-13 disponible sur
// Safari iOS où `BarcodeDetector` n'existe pas (ou ne gère pas le 1D).
//
// Choix d'implémentation :
//   • `@zxing/library` (et non `html5-qrcode`) → on maîtrise la résolution du
//     canvas d'analyse et les hints passés à ZXing.
//   • Hints `POSSIBLE_FORMATS` (1D uniquement) + `TRY_HARDER: true` : ZXing
//     balaie davantage de lignes de scan, ce qui est déterminant sur un code
//     photographié légèrement incliné ou peu contrasté.
//   • Import dynamique : le décodeur (~150 kB) n'est chargé qu'à l'ouverture
//     du scanner, jamais au démarrage de l'application.
// ─────────────────────────────────────────────────────────────────────────────

import { describeError } from './utils'

export type DecodeOutcome = { ok: true; text: string } | { ok: false; error: string }

export type CanvasDecoder = (canvas: HTMLCanvasElement) => DecodeOutcome

let decoderPromise: Promise<CanvasDecoder> | null = null

/**
 * Charge (une seule fois) le décodeur ZXing 1D.
 *
 * La promesse est mémorisée : en cas d'échec elle est réinitialisée pour
 * permettre une nouvelle tentative au prochain scan.
 */
export function getZxingDecoder(): Promise<CanvasDecoder> {
  if (!decoderPromise) {
    decoderPromise = buildDecoder().catch((error: unknown) => {
      decoderPromise = null
      throw error
    })
  }
  return decoderPromise
}

async function buildDecoder(): Promise<CanvasDecoder> {
  const [
    { default: MultiFormatReader },
    { default: BinaryBitmap },
    { default: HybridBinarizer },
    { HTMLCanvasElementLuminanceSource },
    { default: DecodeHintType },
    { default: BarcodeFormat },
  ] = await Promise.all([
    import('@zxing/library/esm/core/MultiFormatReader'),
    import('@zxing/library/esm/core/BinaryBitmap'),
    import('@zxing/library/esm/core/common/HybridBinarizer'),
    import('@zxing/library/esm/browser/HTMLCanvasElementLuminanceSource'),
    import('@zxing/library/esm/core/DecodeHintType'),
    import('@zxing/library/esm/core/BarcodeFormat'),
  ])

  const possibleFormats = [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ]

  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, possibleFormats)
  hints.set(DecodeHintType.TRY_HARDER, true)

  const reader = new MultiFormatReader()
  reader.setHints(hints)

  return (canvas: HTMLCanvasElement): DecodeOutcome => {
    try {
      const source = new HTMLCanvasElementLuminanceSource(canvas)
      const bitmap = new BinaryBitmap(new HybridBinarizer(source))
      // `decodeWithState` réutilise les `readers` préparés par `setHints` :
      // nettement plus rapide que `decode()` en boucle continue.
      const result = reader.decodeWithState(bitmap)
      const text = result?.getText?.() ?? ''
      return text ? { ok: true, text } : { ok: false, error: 'résultat vide' }
    } catch (error) {
      // `NotFoundException` = frame sans code : cas normal, on remonte juste
      // le libellé pour l'affichage de diagnostic.
      return { ok: false, error: describeError(error) }
    }
  }
}