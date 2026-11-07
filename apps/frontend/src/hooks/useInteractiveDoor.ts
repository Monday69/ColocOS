import { useRef, useCallback } from 'react';
import { useSpring, type SpringConfig } from '@react-spring/three';
import { useDrag } from '@use-gesture/react';
import { useNavStore } from '@/store';
import { useThree } from '@react-three/fiber';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — useInteractiveDoor Hook
//
// MATHÉMATIQUES — Conversion Δx_souris → Δθ_porte :
//
//   Le pointeur souris se déplace dans l'espace 2D normalisé NDC [-1, +1].
//   On veut en extraire une variation angulaire radiale pour la porte.
//
//   Approche choisie : facteur de sensibilité empirique calibré sur le FOV
//   et la distance caméra-porte. Pour FOV=42° et dist≈4.5m :
//
//     sensitivity = 1 / (viewport.width * PIXELS_PER_RADIAN_INV)
//
//   où PIXELS_PER_RADIAN_INV ≈ 1/220 (déterminé par calibration manuelle).
//
//   Signe : glisser vers la gauche (-Δx) ouvre la porte (+θ en Y).
//   L'axe Y de Three.js pointe vers le haut (main droite), donc une rotation
//   positive = sens horaire vu du dessus = ouverture vers le spectateur.
//
// PIVOT DE CHARNIÈRE :
//   La porte pivote autour de son bord GAUCHE (charnière), pas de son centre.
//   Résolu par un groupe-pivot décalé : le mesh est positionné à +x=+0.425
//   dans son groupe parent. La rotation du groupe produit le pivot correct.
//
// SPRING PHYSICS :
//   On distingue 3 phases :
//     - DRAGGING   : la rotation suit le pointeur avec un léger lag (mass=1)
//     - SNAP_OPEN  : θ > THRESHOLD → ressort vers 105° (tension=180, friction=16)
//     - SNAP_CLOSE : θ ≤ THRESHOLD → ressort vers 0° (tension=220, friction=20)
//
//   tension=180 + friction=16 produit ~1.5 oscillations → effet de rebond naturel.
//   Plus friction est bas, plus le rebond est prononcé.
// ─────────────────────────────────────────────────────────────────────────────

// ── Constantes ────────────────────────────────────────────────────────────────

const DOOR_MIN_ANGLE_RAD  = 0;                        // fermé
const DOOR_MAX_ANGLE_RAD  = (105 * Math.PI) / 180;    // ouvert (105°)
const SNAP_THRESHOLD_RAD  = (50  * Math.PI) / 180;    // 50° → snap ouvert

// Pixels horizontaux correspondant à 1 radian de rotation porte
// Calibré pour camera.fov=42, camera.position.z≈4.5, porte à z≈-0.4
const SENSITIVITY = 220; // px/rad

// Spring configs
const SPRING_SNAP_OPEN: SpringConfig = {
  tension: 180,
  friction: 16,
  mass: 1.2,
};
const SPRING_SNAP_CLOSE: SpringConfig = {
  tension: 220,
  friction: 20,
  mass: 1,
};
const SPRING_DRAG: SpringConfig = {
  tension: 600,
  friction: 30,
  mass: 0.8,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface DoorSpringValues {
  /** Rotation Y en radians — à appliquer sur le groupe-pivot charnière */
  rotationY: number;
  /** Intensité lumineuse intérieure 0..1 — interpolée avec la rotation */
  lightIntensity: number;
}

export function useInteractiveDoor() {
  const { size } = useThree();
  const { setDoorOpen } = useNavStore();

  // Angle courant pendant le drag (ref pour éviter les re-renders inutiles)
  const angleRef = useRef(0);

  // Spring principal — anime la rotation Y
  const [spring, api] = useSpring<{ rotY: number; lightIntensity: number }>(() => ({
    rotY: 0,
    lightIntensity: 0,
    config: SPRING_DRAG,
  }));

  // Gesture drag
  const bind = useDrag(
    ({ active, movement: [mx], last, memo = angleRef.current }) => {
      if (active) {
        // ── Phase dragging ──────────────────────────────────────────────────
        // Convertit les pixels en radians et applique avec clamp
        const deltaRad = -mx / SENSITIVITY;  // signe négatif : gauche = ouvrir
        const rawAngle = memo + deltaRad;
        const clampedAngle = Math.max(
          DOOR_MIN_ANGLE_RAD,
          Math.min(DOOR_MAX_ANGLE_RAD, rawAngle),
        );

        angleRef.current = clampedAngle;

        // Light intensity proportionnelle à l'ouverture (0 → 0, 105° → 1)
        const openRatio = clampedAngle / DOOR_MAX_ANGLE_RAD;

        api.start({
          rotY: clampedAngle,
          lightIntensity: openRatio,
          config: SPRING_DRAG,
          immediate: false,
        });
      }

      if (last) {
        // ── Phase release — snap vers cible ────────────────────────────────
        const currentAngle = angleRef.current;
        const snapToOpen   = currentAngle > SNAP_THRESHOLD_RAD;
        const targetAngle  = snapToOpen ? DOOR_MAX_ANGLE_RAD : DOOR_MIN_ANGLE_RAD;

        angleRef.current = targetAngle;

        api.start({
          rotY: targetAngle,
          lightIntensity: snapToOpen ? 1 : 0,
          config: snapToOpen ? SPRING_SNAP_OPEN : SPRING_SNAP_CLOSE,
        });

        // Notifie le store pour désactiver les raycast derrière la porte fermée
        setDoorOpen(snapToOpen);
      }

      return memo;
    },
    {
      // Filtre : seulement les mouvements principalement horizontaux
      axis: 'x',
      // Évite de déclencher pendant la rotation OrbitControls
      filterTaps: true,
      pointer: { touch: true },
    },
  );

  // Expose un contrôle programmatique (clic simple = toggle)
  const toggleDoor = useCallback(() => {
    const isOpen = angleRef.current > SNAP_THRESHOLD_RAD;
    const targetAngle = isOpen ? DOOR_MIN_ANGLE_RAD : DOOR_MAX_ANGLE_RAD;

    angleRef.current = targetAngle;
    api.start({
      rotY: targetAngle,
      lightIntensity: isOpen ? 0 : 1,
      config: isOpen ? SPRING_SNAP_CLOSE : SPRING_SNAP_OPEN,
    });
    setDoorOpen(!isOpen);
  }, [api, setDoorOpen]);

  return {
    /** Bind les event handlers sur le mesh de la porte */
    bind,
    /** Valeurs spring animées */
    rotY: spring.rotY,
    lightIntensity: spring.lightIntensity,
    /** Toggle programmatique (clic simple) */
    toggleDoor,
    /** Angle courant instantané (pour les décisions logiques) */
    angleRef,
  };
}