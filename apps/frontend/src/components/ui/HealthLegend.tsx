import type { CSSProperties } from 'react';
import { HEALTH_COLORS } from '@/lib/healthColors';
import { useNavStore, useUIStore } from '@/store';

const LEGEND_ITEMS = [
  { status: 'critical', label: 'Critique (≤ 2j)',  color: HEALTH_COLORS.critical },
  { status: 'warning',  label: 'Attention (≤ 7j)', color: HEALTH_COLORS.warning  },
  { status: 'ok',       label: 'OK',               color: HEALTH_COLORS.ok       },
  { status: 'empty',    label: 'Vide',             color: HEALTH_COLORS.empty    },
] as const;

/**
 * Légende des couleurs de santé du frigo.
 *
 * Affichée uniquement sur l'onglet FRIGO, en vue d'ensemble : dès qu'une clayette
 * est ouverte, qu'un produit est sélectionné ou qu'on navigue sur un autre onglet
 * (SCAN notamment), le widget disparaît pour ne plus recouvrir les cartes
 * d'action et les boutons de confirmation.
 */
export function HealthLegend() {
  const isIntroActive = useUIStore((s) => s.isIntroActive);
  const activeModule = useNavStore((s) => s.activeModule);
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const selectedItemId = useUIStore((s) => s.selectedItemId);
  const zoneDetail = useUIStore((s) => s.zoneDetail);

  const isOverview =
    activeModule === 'fridge' && !selectedMeshId && !selectedItemId && !zoneDetail;
  if (!isOverview) return null;

  return (
    <div
      className={`absolute left-4 bottom-[var(--legend-bottom)] md:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] pointer-events-none select-none animate-fade-up z-10 transition-opacity duration-500 ${
        isIntroActive ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ '--legend-bottom': 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' } as CSSProperties}
    >
      <div className="panel px-3 py-2.5 flex flex-col gap-1.5">
        <div className="label-micro mb-1">État de santé</div>
        {LEGEND_ITEMS.map((item) => (
          <div key={item.status} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-white/15"
              style={{
                backgroundColor: item.color,
                boxShadow: `0 0 8px ${item.color}70`,
              }}
            />
            <span className="font-sans text-[11px] text-slate-300/90 tabular-nums">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}