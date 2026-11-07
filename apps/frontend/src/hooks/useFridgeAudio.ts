import { useRef, useCallback, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — useFridgeAudio Hook
//
// Système audio 100% synthétique — zéro fichier externe.
// Tous les sons sont générés programmatiquement via Web Audio API.
//
// ── ARCHITECTURE DU GRAPHE AUDIO ────────────────────────────────────────────
//
//   OscillatorNode (55 Hz sinus)     ← hum moteur
//     └─ BiquadFilter (highpass)     ← "s'éclaircit" à l'ouverture
//        └─ GainNode (motorGain)     ← volume moteur (0.55 → 0.28)
//           └─ GainNode (masterGain) ← mute global
//              └─ AudioContext.destination
//
//   OscillatorNode (bruit rose)      ← vibration mécanique
//     └─ GainNode (noiseGain)
//        └─ masterGain
//
// ── SYNCHRONISATION ANGLE → AUDIO (via useFrame) ───────────────────────────
//
//   ratio = angleRef.current / DOOR_MAX_ANGLE   [0..1]
//
//   motorGain.value     = lerp(0.55, 0.28, ratio)
//   highpassFreq.value  = 80 × (1200/80)^ratio   ← exponentielle perceptuelle
//   noiseGain.value     = lerp(0.08, 0.04, ratio)
//
//   Anti-zipper : on utilise linearRampToValueAtTime(v, now+0.016)
//   plutôt que d'écrire directement sur .value en boucle.
//
// ── SFX SYNTHÉTIQUES ────────────────────────────────────────────────────────
//
//   clickOpen  : burst bruit blanc 40ms + filtre bandpass 800Hz → "clic mécanique"
//   magnetClose: chute gain rapide (60ms) d'un oscil 120Hz → "joint magnétique"
//   alarmBeep  : deux bips 880Hz / 50ms séparés de 200ms → "frigo ouvert >15s"
//   uiBlip     : sinus 1200Hz / 20ms fade-out → micro-son pour toasts
//
// ─────────────────────────────────────────────────────────────────────────────

const DOOR_MAX_ANGLE_RAD = (105 * Math.PI) / 180;

// Audio constantes moteur
const MOTOR_FREQ        = 55;    // Hz — fondamentale du hum
const MOTOR_GAIN_CLOSED = 0.55;
const MOTOR_GAIN_OPEN   = 0.28;  // −50% volume
const HP_FREQ_CLOSED    = 80;    // Hz — filtre passe-haut fermé
const HP_FREQ_OPEN      = 1200;  // Hz — filtre passe-haut ouvert

// Durée de rampe audio anti-zipper (1 frame à 60fps)
const RAMP_TIME = 0.016;

// ── Petit AudioContext singleton (évite les doublons) ─────────────────────────
let globalAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
    globalAudioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 44100 });
  }
  return globalAudioCtx;
}

// ── Générateur de bruit blanc (BufferSourceNode) ──────────────────────────────
function createWhiteNoise(ctx: AudioContext, durationSec: number): AudioBufferSourceNode {
  const bufLen = Math.ceil(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data   = buffer.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

// ── Hook principal ────────────────────────────────────────────────────────────

export interface FridgeAudioControls {
  /** Lance le moteur audio (nécessite une interaction utilisateur préalable) */
  start: () => void;
  /** Arrête tous les sons */
  stop: () => void;
  /** Bascule mute global */
  toggleMute: () => void;
  /** Joue le son d'ouverture porte */
  playClickOpen: () => void;
  /** Joue le son de fermeture magnétique */
  playMagnetClose: () => void;
  /** Joue l'alarme "porte ouverte >15s" */
  playOpenAlarm: () => void;
  /** Micro-son pour toast critique */
  playUiBlip: (type: 'success' | 'error') => void;
  /** Est-ce que le son est actif */
  isRunning: boolean;
}

export function useFridgeAudio(angleRef: React.MutableRefObject<number>): FridgeAudioControls {
  const isMuted   = useStore(s => s.isMuted);
  const setMuted  = useStore(s => s.setMuted);

  // Refs pour les nœuds audio — stables entre renders
  const ctxRef          = useRef<AudioContext | null>(null);
  const masterGainRef   = useRef<GainNode | null>(null);
  const motorGainRef    = useRef<GainNode | null>(null);
  const hpFilterRef     = useRef<BiquadFilterNode | null>(null);
  const motorOscRef     = useRef<OscillatorNode | null>(null);
  const noiseGainRef    = useRef<GainNode | null>(null);
  const isRunningRef    = useRef(false);

  // Suivi angle précédent pour détecter transition open/close
  const prevAngleRef    = useRef(0);
  const wasOpenRef      = useRef(false);
  const openTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initialise le graphe audio ─────────────────────────────────────────────
  const buildGraph = useCallback(() => {
    const ctx = getAudioContext();
    ctxRef.current = ctx;

    // Master gain (mute)
    const master = ctx.createGain();
    master.gain.value = isMuted ? 0 : 1;
    master.connect(ctx.destination);
    masterGainRef.current = master;

    // Motor gain
    const motorGain = ctx.createGain();
    motorGain.gain.value = MOTOR_GAIN_CLOSED;
    motorGain.connect(master);
    motorGainRef.current = motorGain;

    // Highpass filter
    const hp = ctx.createBiquadFilter();
    hp.type            = 'highpass';
    hp.frequency.value = HP_FREQ_CLOSED;
    hp.Q.value         = 0.7;
    hp.connect(motorGain);
    hpFilterRef.current = hp;

    // Motor oscillator — onde sinusoïdale + harmonique pour richesse
    const osc = ctx.createOscillator();
    osc.type            = 'sawtooth'; // plus riche qu'un sinus pur
    osc.frequency.value = MOTOR_FREQ;

    // Légère modulation de fréquence (vibration irrégulière du moteur)
    const modOsc = ctx.createOscillator();
    modOsc.frequency.value = 0.8;  // 0.8 Hz — lente
    const modGain = ctx.createGain();
    modGain.gain.value = 1.5;      // ±1.5 Hz de variation
    modOsc.connect(modGain);
    modGain.connect(osc.frequency);

    osc.connect(hp);
    osc.start();
    modOsc.start();
    motorOscRef.current = osc;

    // Noise layer — vibration mécanique basse (filtered white noise)
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noiseGain.connect(master);
    noiseGainRef.current = noiseGain;

    // Bruit rose via white noise + lowpass à 200Hz
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type            = 'lowpass';
    noiseFilter.frequency.value = 200;
    noiseFilter.Q.value         = 0.5;
    noiseFilter.connect(noiseGain);

    // Bruit continu (buffer 2s en boucle)
    const noiseSrc = createWhiteNoise(ctx, 2);
    noiseSrc.loop = true;
    noiseSrc.connect(noiseFilter);
    noiseSrc.start();

    isRunningRef.current = true;
  }, [isMuted]);

  // ── start / stop ──────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (isRunningRef.current) return;
    if (ctxRef.current?.state === 'suspended') {
      ctxRef.current.resume();
      isRunningRef.current = true;
      return;
    }
    buildGraph();
  }, [buildGraph]);

  const stop = useCallback(() => {
    if (!ctxRef.current) return;
    ctxRef.current.suspend();
    isRunningRef.current = false;
  }, []);

  // ── Mute ──────────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setMuted(newMuted);
    if (masterGainRef.current && ctxRef.current) {
      const t = ctxRef.current.currentTime;
      masterGainRef.current.gain.linearRampToValueAtTime(newMuted ? 0 : 1, t + 0.08);
    }
  }, [isMuted, setMuted]);

  // ── SFX : clic mécanique d'ouverture ─────────────────────────────────────
  const playClickOpen = useCallback(() => {
    if (!masterGainRef.current || isMuted) return;
    const ctx = ctxRef.current!;
    const t   = ctx.currentTime;

    // Burst de bruit blanc court passé par bandpass → "clic" mécanique
    const noise = createWhiteNoise(ctx, 0.05);
    const bp    = ctx.createBiquadFilter();
    bp.type            = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value         = 3.0;

    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.6, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    noise.connect(bp);
    bp.connect(clickGain);
    clickGain.connect(masterGainRef.current);
    noise.start(t);
    noise.stop(t + 0.05);

    // Petit "body impact" — sinus grave très court
    const body = ctx.createOscillator();
    body.type            = 'sine';
    body.frequency.setValueAtTime(120, t);
    body.frequency.exponentialRampToValueAtTime(40, t + 0.06);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.35, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    body.connect(bodyGain);
    bodyGain.connect(masterGainRef.current);
    body.start(t);
    body.stop(t + 0.07);
  }, [isMuted]);

  // ── SFX : joint magnétique (fermeture) ───────────────────────────────────
  const playMagnetClose = useCallback(() => {
    if (!masterGainRef.current || isMuted) return;
    const ctx = ctxRef.current!;
    const t   = ctx.currentTime;

    // Oscillation grave qui chute rapidement → "thump" magnétique
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.08);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.10);

    osc.connect(g);
    g.connect(masterGainRef.current);
    osc.start(t);
    osc.stop(t + 0.12);

    // Clic de fermeture sur le joint (burst bruit blanc encore plus court)
    const click = createWhiteNoise(ctx, 0.02);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.3, t + 0.07);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    click.connect(clickGain);
    clickGain.connect(masterGainRef.current);
    click.start(t + 0.07);
    click.stop(t + 0.10);
  }, [isMuted]);

  // ── SFX : alarme porte ouverte >15s ──────────────────────────────────────
  const playOpenAlarm = useCallback(() => {
    if (!masterGainRef.current || isMuted) return;
    const ctx = ctxRef.current!;
    const t   = ctx.currentTime;

    // Deux bips courts : style système embarqué
    [0, 0.22].forEach(delay => {
      const osc = ctx.createOscillator();
      osc.type            = 'square';
      osc.frequency.value = 880;

      // Légère descente de fréquence pour chaque bip
      osc.frequency.setValueAtTime(880, t + delay);
      osc.frequency.linearRampToValueAtTime(820, t + delay + 0.055);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.18, t + delay + 0.004);
      g.gain.setValueAtTime(0.18, t + delay + 0.05);
      g.gain.linearRampToValueAtTime(0, t + delay + 0.06);

      osc.connect(g);
      g.connect(masterGainRef.current!);
      osc.start(t + delay);
      osc.stop(t + delay + 0.07);
    });
  }, [isMuted]);

  // ── SFX : micro-son toast UI ──────────────────────────────────────────────
  const playUiBlip = useCallback((type: 'success' | 'error') => {
    if (!masterGainRef.current || isMuted) return;
    const ctx = ctxRef.current!;
    const t   = ctx.currentTime;

    const freq = type === 'success' ? 1200 : 400;
    const dur  = type === 'success' ? 0.025 : 0.04;

    const osc = ctx.createOscillator();
    osc.type            = type === 'success' ? 'sine' : 'square';
    osc.frequency.value = freq;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(g);
    g.connect(masterGainRef.current);
    osc.start(t);
    osc.stop(t + dur + 0.005);
  }, [isMuted]);

  // ── useFrame : synchronisation audio ↔ angle de porte ────────────────────
  //
  // Lit angleRef.current à chaque frame (60fps).
  // Met à jour les AudioParams via linearRamp (anti-zipper noise).
  // Détecte les transitions pour déclencher les SFX.
  //
  useFrame(() => {
    if (!isRunningRef.current || !ctxRef.current) return;

    const ctx   = ctxRef.current;
    const angle = angleRef.current;
    const ratio = Math.min(angle / DOOR_MAX_ANGLE_RAD, 1); // 0..1
    const t     = ctx.currentTime;
    const ramp  = t + RAMP_TIME;

    // ── Moteur gain — linéaire ────────────────────────────────────────────
    if (motorGainRef.current) {
      const targetGain = MOTOR_GAIN_CLOSED + (MOTOR_GAIN_OPEN - MOTOR_GAIN_CLOSED) * ratio;
      motorGainRef.current.gain.linearRampToValueAtTime(targetGain, ramp);
    }

    // ── Highpass freq — exponentielle perceptuelle ─────────────────────────
    //   f = HP_FREQ_CLOSED × (HP_FREQ_OPEN / HP_FREQ_CLOSED)^ratio
    if (hpFilterRef.current) {
      const targetFreq = HP_FREQ_CLOSED * Math.pow(HP_FREQ_OPEN / HP_FREQ_CLOSED, ratio);
      hpFilterRef.current.frequency.linearRampToValueAtTime(targetFreq, ramp);
    }

    // ── Noise gain — diminue légèrement à l'ouverture ─────────────────────
    if (noiseGainRef.current) {
      const targetNoise = 0.08 - 0.04 * ratio;
      noiseGainRef.current.gain.linearRampToValueAtTime(targetNoise, ramp);
    }

    // ── Détection transition fermé→ouvert (début d'ouverture) ─────────────
    const OPEN_THRESHOLD = 0.05; // ~5° — premier mouvement détectable
    const isNowOpen = angle > OPEN_THRESHOLD;

    if (isNowOpen && !wasOpenRef.current) {
      // Transition : porte commence à s'ouvrir
      playClickOpen();
      wasOpenRef.current = true;

      // Timer alarme 15s
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      openTimerRef.current = setTimeout(() => {
        if (angleRef.current > OPEN_THRESHOLD) playOpenAlarm();
      }, 15_000);
    }

    if (!isNowOpen && wasOpenRef.current) {
      // Transition : porte revient à 0° → joint magnétique
      // Déclenchement seulement si on était vraiment ouvert (>20°) pour
      // éviter les faux positifs sur de petits rebonds
      if (prevAngleRef.current > 0.35) {
        playMagnetClose();
      }
      wasOpenRef.current = false;
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
    }

    prevAngleRef.current = angle;
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      // Ne pas fermer le contexte global — d'autres instances peuvent l'utiliser
    };
  }, []);

  // ── Sync mute depuis le store (changé depuis le HUD) ─────────────────────
  useEffect(() => {
    if (!masterGainRef.current || !ctxRef.current) return;
    const t = ctxRef.current.currentTime;
    masterGainRef.current.gain.linearRampToValueAtTime(isMuted ? 0 : 1, t + 0.08);
  }, [isMuted]);

  return {
    start,
    stop,
    toggleMute,
    playClickOpen,
    playMagnetClose,
    playOpenAlarm,
    playUiBlip,
    isRunning: isRunningRef.current,
  };
}