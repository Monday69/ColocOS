import type { ZoneLayout } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — 3D Zone Layout
//
// RÔLE DE CE FICHIER :
//   Définit les positions et tailles des zones dans l'espace 3D pour le
//   rendu Box geometry (sprint actuel).
//
// MIGRATION GLTF (prochain sprint) :
//   Quand useGLTF sera intégré, ce fichier reste utile pour :
//     1. Le fallback si un meshId n'est pas trouvé dans le GLTF
//     2. Les overlays HTML positionnés en world space
//     3. Le raycasting de zones qui n'ont pas de mesh dédié
//
// CONVENTION D'AXES :
//   X → gauche/droite
//   Y → bas/haut
//   Z → profondeur (positif vers le spectateur)
// ─────────────────────────────────────────────────────────────────────────────

export const ZONE_LAYOUT: ZoneLayout[] = [
  // ── Corps du réfrigérateur ────────────────────────────────────────────────
  {
    meshId: 'fridge_shelf_top',
    label: 'Étagère haute',
    position: [0, 1.1, 0],
    size: [0.75, 0.08, 0.55],
    group: 'fridge',
  },
  {
    meshId: 'fridge_shelf_middle',
    label: 'Étagère milieu',
    position: [0, 0.65, 0],
    size: [0.75, 0.08, 0.55],
    group: 'fridge',
  },
  {
    meshId: 'fridge_shelf_bottom',
    label: 'Étagère basse',
    position: [0, 0.2, 0],
    size: [0.75, 0.08, 0.55],
    group: 'fridge',
  },
  {
    meshId: 'fridge_crisper_left',
    label: 'Bac légumes G',
    position: [-0.2, -0.22, 0],
    size: [0.35, 0.16, 0.55],
    group: 'fridge',
  },
  {
    meshId: 'fridge_crisper_right',
    label: 'Bac légumes D',
    position: [0.2, -0.22, 0],
    size: [0.35, 0.16, 0.55],
    group: 'fridge',
  },

  // ── Porte ─────────────────────────────────────────────────────────────────
  {
    meshId: 'fridge_door_shelf_1',
    label: 'Porte haut',
    position: [0, 1.0, -0.72],
    size: [0.75, 0.1, 0.12],
    group: 'door',
  },
  {
    meshId: 'fridge_door_shelf_2',
    label: 'Porte milieu',
    position: [0, 0.6, -0.72],
    size: [0.75, 0.1, 0.12],
    group: 'door',
  },
  {
    meshId: 'fridge_door_shelf_3',
    label: 'Porte beurre',
    position: [0, 0.2, -0.72],
    size: [0.75, 0.09, 0.12],
    group: 'door',
  },

  // ── Congélateur ───────────────────────────────────────────────────────────
  {
    meshId: 'freezer_drawer_1',
    label: 'Congélo tiroir 1',
    position: [0, -0.62, 0],
    size: [0.75, 0.1, 0.55],
    group: 'fridge',
  },
  {
    meshId: 'freezer_drawer_2',
    label: 'Congélo tiroir 2',
    position: [0, -0.78, 0],
    size: [0.75, 0.08, 0.55],
    group: 'fridge',
  },

  // ── Placard gauche ────────────────────────────────────────────────────────
  {
    meshId: 'cabinet_left_shelf_1',
    label: 'Placard G haut',
    position: [-1.6, 0.7, 0],
    size: [0.8, 0.06, 0.5],
    group: 'cabinet_left',
  },
  {
    meshId: 'cabinet_left_shelf_2',
    label: 'Placard G bas',
    position: [-1.6, 0.2, 0],
    size: [0.8, 0.06, 0.5],
    group: 'cabinet_left',
  },

  // ── Placard droit ─────────────────────────────────────────────────────────
  {
    meshId: 'cabinet_right_shelf_1',
    label: 'Placard D haut',
    position: [1.6, 0.7, 0],
    size: [0.8, 0.06, 0.5],
    group: 'cabinet_right',
  },
  {
    meshId: 'cabinet_right_shelf_2',
    label: 'Placard D bas',
    position: [1.6, 0.2, 0],
    size: [0.8, 0.06, 0.5],
    group: 'cabinet_right',
  },

  // ── Garde-manger ──────────────────────────────────────────────────────────
  {
    meshId: 'pantry_shelf_1',
    label: 'Garde-manger 1',
    position: [2.8, 0.6, 0],
    size: [0.9, 0.06, 0.55],
    group: 'pantry',
  },
  {
    meshId: 'pantry_shelf_2',
    label: 'Garde-manger 2',
    position: [2.8, 0.1, 0],
    size: [0.9, 0.06, 0.55],
    group: 'pantry',
  },
];

// Map indexée pour accès O(1) dans les composants 3D
export const ZONE_LAYOUT_MAP: Record<string, ZoneLayout> = Object.fromEntries(
  ZONE_LAYOUT.map((z) => [z.meshId, z]),
);