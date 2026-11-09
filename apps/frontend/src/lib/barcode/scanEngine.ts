// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Moteur de scan de codes-barres 1D
//
// Pourquoi ne plus passer par `html5-qrcode` :
//   • son canvas d'analyse est dimensionné à la taille CSS du viseur (≈ 390×600
//     sur un iPhone plein écran), pas à la résolution du flux : même en 1920×1080,
//     `drawImage()` rééchantillonne à 390 px de large et les barres fines de
//     l'EAN-13 deviennent illisibles ⇒ aucune détection, aucune erreur ;
//   • il teste `"BarcodeDetector" in window` sans vérifier les formats 1D : sur
//     iOS il peut sélectionner un décodeur natif qui ne renvoie jamais rien ;
//   • il rejoue chaque frame échouée en miroir (`disableFlip`) et cache ses
//     erreurs (`qrCodeErrorCallback`), donc aucun diagnostic exploitable.
//
// Ce moteur-ci découple explicitement les trois étapes :
//   1. acquisition  : getUserMedia avec contraintes de résolution réelles ;
//   2. échantillonnage : canvas dimensionné sur `videoWidth`/`videoHeight`
//      (zone réellement visible, cf. `object-fit: cover`) ;
//   3. décodage : `BarcodeDetector` natif **si réellement compatible ean_13**,
//      sinon ZXing pur JS, avec repli automatique du natif vers ZXing.
//
// La boucle est sérialisée (une frame décodée à la fois) à 10 fps : au-delà,
// ZXing sature le CPU d'un iPhone et saute des frames en cours de décodage.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createNativeDetector,
  probeNativeBarcodeDetector,
  type NativeBarcodeDetector,
  type NativeDetectorProbe,
} from './capabilities'
import { getZxingDecoder, type CanvasDecoder } from './zxingDecoder'
import { describeError } from './utils'

/** Cadence de décodage (frames/s). 10 est le meilleur compromis CPU / réussite sur iOS. */
export const SCAN_FPS = 10

/** Largeur maximale du canvas d'analyse : au-delà, le gain de netteté ne compense plus le coût CPU. */
const MAX_ANALYSIS_WIDTH = 1440

/** Nombre de frames échouées avant de tenter une rotation à 90° (code présenté « debout »). */
const ROTATE_AFTER_MISSES = 10

/** Erreurs consécutives du détecteur natif avant bascule définitive vers ZXing. */
const NATIVE_MAX_ERRORS = 4

/** Tentative d'ouverture caméra : `focusMode` n'existe pas dans lib.dom. */
type ExtendedTrackConstraints = MediaTrackConstraints & {
  focusMode?: 'none' | 'manual' | 'single-shot' | 'continuous'
}

export type ScanEngineName = 'native' | 'zxing' | null

/** Instantané de diagnostic affiché dans le bandeau de debug du scanner. */
export interface ScanStats {
  engine: ScanEngineName
  /** Moteur effectivement utilisé, tel qu'affiché (« zxing », « natif »…). */
  engineLabel: string
  probe: NativeDetectorProbe | null
  camera: string
  deviceId: string
  videoWidth: number
  videoHeight: number
  canvasWidth: number
  canvasHeight: number
  frames: number
  fps: number
  lastError: string | null
  /** Explication du passage natif → ZXing, `null` si aucun repli. */
  fallbackNote: string | null
  streamActive: boolean
}

export interface ScanEngineCallbacks {
  onDetected: (barcode: string) => void
  /** Erreur bloquante : flux interrompu, aucune caméra utilisable, décodeur indisponible. */
  onFatal: (message: string) => void
}

interface Region {
  sx: number
  sy: number
  sw: number
  sh: number
}

export class BarcodeScanEngine {
  private readonly video: HTMLVideoElement
  private readonly callbacks: ScanEngineCallbacks

  private stream: MediaStream | null = null
  private running = false
  private timer: number | null = null
  private loopStartedAt = 0

  private canvas: HTMLCanvasElement | null = null
  private rotatedCanvas: HTMLCanvasElement | null = null

  private engine: ScanEngineName = null
  private detector: NativeBarcodeDetector | null = null
  private decoder: CanvasDecoder | null = null
  private probe: NativeDetectorProbe | null = null
  private switchingToZxing: Promise<void> | null = null

  private camera = 'inconnue'
  private deviceId = ''
  private frames = 0
  private misses = 0
  private nativeErrors = 0
  private lastError: string | null = null
  private fallbackNote: string | null = null

  constructor(video: HTMLVideoElement, callbacks: ScanEngineCallbacks) {
    this.video = video
    this.callbacks = callbacks
  }

  // ── Démarrage ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    // 1. Décodage : natif seulement si EAN-13 réellement annoncé, sinon ZXing.
    this.probe = await probeNativeBarcodeDetector()
    if (this.probe.usable) {
      this.detector = createNativeDetector(this.probe.usableFormats)
      this.engine = this.detector ? 'native' : 'zxing'
    } else {
      this.engine = 'zxing'
    }
    if (this.engine === 'zxing') {
      await this.loadZxing()
    }
    if (!this.running) return

    // 2. Acquisition vidéo.
    await this.openCamera()
    if (!this.running) {
      this.releaseStream()
      return
    }

    // 3. Boucle de scan.
    this.loopStartedAt = performance.now()
    this.schedule(0)
  }

  /** Coupe la boucle, les pistes caméra et le flux attaché au `<video>`. Idempotent. */
  stop(): void {
    this.running = false
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    this.releaseStream()
  }

  getStats(): ScanStats {
    const elapsed = this.loopStartedAt ? (performance.now() - this.loopStartedAt) / 1000 : 0
    return {
      engine: this.engine,
      engineLabel:
        this.engine === 'native' ? 'BarcodeDetector natif' : this.engine === 'zxing' ? 'ZXing (JS)' : '—',
      probe: this.probe,
      camera: this.camera,
      deviceId: this.deviceId,
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
      canvasWidth: this.canvas?.width ?? 0,
      canvasHeight: this.canvas?.height ?? 0,
      frames: this.frames,
      fps: elapsed > 0.5 ? this.frames / elapsed : 0,
      lastError: this.lastError,
      fallbackNote: this.fallbackNote,
      streamActive: this.stream?.active ?? false,
    }
  }

  // ── Caméra ─────────────────────────────────────────────────────────────────

  private async openCamera(): Promise<void> {
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia indisponible (contexte non sécurisé ?)')
    }

    const cameraId = await this.pickRearCameraId()
    const base: MediaTrackConstraints = cameraId
      ? { deviceId: { exact: cameraId } }
      : { facingMode: { ideal: 'environment' } }

    // Résolution haute obligatoire pour le 1D : `min` garantit un flux net
    // (les barres de l'EAN-13 font ~1 px sur un flux 640×480).
    const highRes: MediaTrackConstraints = {
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      frameRate: { ideal: 30 },
    }

    // Cascade : certaines contraintes (focusMode, min) sont rejetées par iOS,
    // et un deviceId peut devenir obsolète entre deux ouvertures.
    const attempts: MediaTrackConstraints[] = [
      { ...base, ...highRes, focusMode: 'continuous' } as ExtendedTrackConstraints,
      { ...base, ...highRes },
      { ...base, width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: { ideal: 'environment' } },
    ]

    let lastError: unknown = null
    for (const videoConstraints of attempts) {
      try {
        const stream = await mediaDevices.getUserMedia({ video: videoConstraints, audio: false })
        await this.attachStream(stream)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(describeError(lastError))
  }

  private async attachStream(stream: MediaStream): Promise<void> {
    const track = stream.getVideoTracks()[0]
    if (!track) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('flux caméra sans piste vidéo')
    }

    const settings = track.getSettings?.() ?? {}
    this.camera = track.label || 'caméra sans libellé'
    this.deviceId = settings.deviceId ?? ''
    track.addEventListener('ended', () => {
      if (this.running) this.callbacks.onFatal('flux caméra interrompu')
    })

    this.stream = stream
    this.video.srcObject = stream
    this.video.muted = true
    this.video.playsInline = true
    try {
      await this.video.play()
    } catch {
      /* autoplay refusé : le flux reste affiché, `play()` sera retenté au 1er tick */
    }
    await this.waitForDimensions()
  }

  private waitForDimensions(): Promise<void> {
    if (this.video.videoWidth > 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const done = () => {
        this.video.removeEventListener('loadedmetadata', done)
        window.clearTimeout(timer)
        resolve()
      }
      const timer = window.setTimeout(done, 4000)
      this.video.addEventListener('loadedmetadata', done)
    })
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        /* déjà arrêtée */
      }
    })
    this.stream = null
    if (this.video.srcObject) {
      try {
        this.video.pause()
      } catch {
        /* ignoré */
      }
      this.video.srcObject = null
    }
  }

  /**
   * Choix de la caméra arrière principale.
   * `getCameras()` n'expose des libellés qu'après autorisation : sans libellés on
   * laisse `facingMode` décider (l'ordre des deviceId est arbitraire).
   */
  private async pickRearCameraId(): Promise<string | null> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cameras = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device) => ({ id: device.deviceId, label: device.label }))

      if (!cameras.length || !cameras.some((camera) => camera.label)) return null

      const rear = cameras.filter((camera) =>
        /back|rear|arri[eè]re|environment/i.test(camera.label),
      )
      const pool = rear.length > 0 ? rear : cameras

      // Écarte les capteurs non focalisés (ultra grand-angle, macro, télé, depth)
      const main = pool.find(
        (camera) =>
          !/ultra|wide\s*angle|macro|tele|t[eé]l[eé]|depth|profondeur|front|face/i.test(camera.label),
      )
      return (main ?? pool[0])?.id ?? null
    } catch {
      return null
    }
  }

  // ── Boucle de scan ─────────────────────────────────────────────────────────

  private schedule(delay: number): void {
    if (!this.running) return
    this.timer = window.setTimeout(() => {
      void this.tick()
    }, delay)
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    const startedAt = performance.now()

    try {
      // Onglet en arrière-plan : le flux est gelé par iOS, on économise le CPU.
      if (!document.hidden) await this.analyseFrame()
    } catch (error) {
      // Une frame ne doit JAMAIS casser la boucle : on mémorise et on continue.
      this.lastError = describeError(error)
    }

    const elapsed = performance.now() - startedAt
    this.schedule(Math.max(0, 1000 / SCAN_FPS - elapsed))
  }

  private async analyseFrame(): Promise<void> {
    const video = this.video
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
      this.lastError = 'flux vidéo non prêt'
      return
    }
    if (video.paused) {
      try {
        await video.play()
      } catch {
        return
      }
    }

    const region = this.visibleRegion()
    if (!region) return

    this.frames += 1

    // Code présenté « debout » : ZXing ne fait pas tourner l'image lui-même.
    const rotate = this.misses >= ROTATE_AFTER_MISSES && this.frames % 2 === 0
    const canvas = rotate ? this.drawRotated(region) : this.draw(region)
    if (!canvas) return

    let text: string | null = null
    if (this.engine === 'native' && this.detector) {
      text = await this.decodeNative(canvas)
    } else if (this.decoder) {
      const outcome = this.decoder(canvas)
      if (outcome.ok) text = outcome.text
      else this.lastError = outcome.error
    } else {
      this.lastError = 'aucun décodeur initialisé'
      return
    }

    if (text) {
      this.misses = 0
      this.lastError = null
      this.callbacks.onDetected(text)
    } else {
      this.misses += 1
    }
  }

  /** Décodage natif, avec bascule automatique vers ZXing si l'API se révèle inutilisable. */
  private async decodeNative(canvas: HTMLCanvasElement): Promise<string | null> {
    const detector = this.detector
    if (!detector) return null
    try {
      const results = await detector.detect(canvas)
      this.nativeErrors = 0
      return results.length > 0 ? results[0].rawValue : null
    } catch (error) {
      this.nativeErrors += 1
      this.lastError = `natif : ${describeError(error)}`
      if (this.nativeErrors >= NATIVE_MAX_ERRORS) {
        await this.switchToZxing(`BarcodeDetector inutilisable (${describeError(error)})`)
      }
      return null
    }
  }

  private async switchToZxing(reason: string): Promise<void> {
    if (!this.switchingToZxing) {
      this.fallbackNote = reason
      this.detector = null
      this.switchingToZxing = this.loadZxing()
        .then(() => {
          this.engine = 'zxing'
        })
        .catch((error: unknown) => {
          this.callbacks.onFatal(`Décodeur ZXing indisponible : ${describeError(error)}`)
        })
        .finally(() => {
          this.switchingToZxing = null
        })
    }
    await this.switchingToZxing
  }

  private async loadZxing(): Promise<void> {
    try {
      this.decoder = await getZxingDecoder()
    } catch (error) {
      this.callbacks.onFatal(`Décodeur ZXing indisponible : ${describeError(error)}`)
      throw error
    }
  }

  // ── Géométrie ──────────────────────────────────────────────────────────────

  /**
   * Zone du flux réellement affichée dans le `<video>` (`object-fit: cover`).
   * On décode exactement ce que l'utilisateur voit, à la résolution du capteur,
   * et non une version rééchantillonnée à la taille CSS du viseur.
   */
  private visibleRegion(): Region | null {
    const video = this.video
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return null

    const boxWidth = video.clientWidth || vw
    const boxHeight = video.clientHeight || vh
    // Facteur de `object-fit: cover` : le flux est agrandi jusqu'à couvrir la boîte.
    const coverScale = Math.max(boxWidth / vw, boxHeight / vh)
    const sw = Math.min(vw, boxWidth / coverScale)
    const sh = Math.min(vh, boxHeight / coverScale)
    return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh }
  }

  private ensureCanvas(rotated: boolean, width: number, height: number): HTMLCanvasElement {
    const key = rotated ? 'rotatedCanvas' : 'canvas'
    let canvas = this[key]
    if (!canvas) {
      canvas = document.createElement('canvas')
      this[key] = canvas
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    return canvas
  }

  private draw(region: Region): HTMLCanvasElement | null {
    const scale = Math.min(1, MAX_ANALYSIS_WIDTH / Math.max(region.sw, region.sh))
    const dw = Math.round(region.sw * scale)
    const dh = Math.round(region.sh * scale)
    if (dw < 2 || dh < 2) return null

    const canvas = this.ensureCanvas(false, dw, dh)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.imageSmoothingQuality = 'low'
    ctx.drawImage(this.video, region.sx, region.sy, region.sw, region.sh, 0, 0, dw, dh)
    return canvas
  }

  /** Même zone, tournée de 90° (canvas aux dimensions inversées). */
  private drawRotated(region: Region): HTMLCanvasElement | null {
    const scale = Math.min(1, MAX_ANALYSIS_WIDTH / Math.max(region.sw, region.sh))
    const dw = Math.round(region.sw * scale)
    const dh = Math.round(region.sh * scale)
    if (dw < 2 || dh < 2) return null

    const canvas = this.ensureCanvas(true, dh, dw)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.save()
    ctx.translate(dh, 0)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(this.video, region.sx, region.sy, region.sw, region.sh, 0, 0, dw, dh)
    ctx.restore()
    return canvas
  }
}