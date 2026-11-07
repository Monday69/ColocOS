import * as THREE from 'three';
import type { HealthStatus } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — 3D Color System
// Synchronisé avec le design system Tailwind (tailwind.config.js)
// ─────────────────────────────────────────────────────────────────────────────

// ── Palette de base ───────────────────────────────────────────────────────────

export const HEALTH_COLORS: Record<HealthStatus, string> = {
  critical: '#ff3b3b',
  warning:  '#ff9500',
  ok:       '#00e676',
  empty:    '#3a3d45',
};

export const HEALTH_EMISSIVE: Record<HealthStatus, string> = {
  critical: '#ff1a1a',
  warning:  '#cc7700',
  ok:       '#00cc5e',
  empty:    '#1a1c22',
};

export const HEALTH_EMISSIVE_INTENSITY: Record<HealthStatus, number> = {
  critical: 0.6,
  warning:  0.4,
  ok:       0.25,
  empty:    0.05,
};

// Intensité alpha du mesh (transparent = moins d'items)
export const HEALTH_OPACITY: Record<HealthStatus, number> = {
  critical: 0.92,
  warning:  0.88,
  ok:       0.82,
  empty:    0.30,
};

// Couleur au survol (légèrement plus claire/brillante)
export const HEALTH_HOVER_EMISSIVE_INTENSITY: Record<HealthStatus, number> = {
  critical: 1.2,
  warning:  0.9,
  ok:       0.7,
  empty:    0.3,
};

// ── Helpers Three.js ──────────────────────────────────────────────────────────

/** Retourne un THREE.Color pour le healthStatus donné */
export function getHealthColor(status: HealthStatus): THREE.Color {
  return new THREE.Color(HEALTH_COLORS[status]);
}

/** Retourne la couleur emissive Three.js */
export function getEmissiveColor(status: HealthStatus): THREE.Color {
  return new THREE.Color(HEALTH_EMISSIVE[status]);
}

/** Couleur de l'environnement (wireframe de la structure) */
export const STRUCTURE_COLOR = new THREE.Color('#1c1f25');
export const STRUCTURE_EDGE_COLOR = new THREE.Color('#2a2d35');

/** Couleur du sol */
export const FLOOR_COLOR = new THREE.Color('#0d0f12');

/** Couleur de la grille */
export const GRID_COLOR = new THREE.Color('#1a1d24');
export const GRID_COLOR_CENTER = new THREE.Color('#4fc3f7');