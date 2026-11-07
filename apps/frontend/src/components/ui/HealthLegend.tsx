import { HEALTH_COLORS } from '@/lib/healthColors';

const LEGEND_ITEMS = [
  { status: 'critical', label: 'Critique (< 2j)',  color: HEALTH_COLORS.critical },
  { status: 'warning',  label: 'Attention (< 7j)', color: HEALTH_COLORS.warning  },
  { status: 'ok',       label: 'OK',               color: HEALTH_COLORS.ok       },
  { status: 'empty',    label: 'Vide',             color: HEALTH_COLORS.empty    },
] as const;

export function HealthLegend() {
  return (
    <div className="absolute bottom-4 left-4 pointer-events-none select-none animate-fade-up z-10">
      <div className="panel px-3 py-2.5 flex flex-col gap-1.5">
        <div className="label-section mb-1">ÉTAT DE SANTÉ</div>
        {LEGEND_ITEMS.map((item) => (
          <div key={item.status} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{
                backgroundColor: item.color,
                boxShadow: `0 0 6px ${item.color}80`,
              }}
            />
            <span className="font-body text-xs text-text-secondary">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}