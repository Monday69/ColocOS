import { useZoneDetail } from '@/hooks/useZoneDetail';
import { HEALTH_COLORS } from '@/lib/healthColors';
import type { ZoneItemDetail } from '@/types';
import clsx from 'clsx';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Zone Detail Panel
// Panneau latéral droit — glisse au clic sur une zone 3D
// ─────────────────────────────────────────────────────────────────────────────

function NutriScoreBadge({ score }: { score: string | null }) {
  if (!score) return null;
  const colors: Record<string, string> = {
    A: 'bg-green-600',
    B: 'bg-lime-600',
    C: 'bg-yellow-600',
    D: 'bg-orange-600',
    E: 'bg-red-700',
  };
  return (
    <span
      className={clsx(
        'font-mono text-2xs font-500 px-1 py-0.5 rounded text-white',
        colors[score] ?? 'bg-surface-3',
      )}
    >
      {score}
    </span>
  );
}

function ExpiryBadge({ days }: { days: number | null }) {
  if (days === null) return null;

  const label =
    days < 0
      ? `PÉRIMÉ`
      : days === 0
      ? `AUJOURD'HUI`
      : `J+${days}`;

  const color =
    days < 0 ? HEALTH_COLORS.critical : days <= 2 ? HEALTH_COLORS.critical : days <= 7 ? HEALTH_COLORS.warning : '#5a5d6e';

  return (
    <span className="font-mono text-2xs px-1.5 py-0.5 rounded" style={{ color, border: `1px solid ${color}40` }}>
      {label}
    </span>
  );
}

function ItemRow({ item }: { item: ZoneItemDetail }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-surface-border/50 last:border-0">
      {/* Owner color dot */}
      <div
        className="status-dot mt-1.5 flex-shrink-0"
        style={{ backgroundColor: item.owner?.colorHex ?? '#3a3d45' }}
        title={item.owner?.name ?? 'Partagé'}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-body text-sm text-text-primary truncate">{item.name}</span>
          <NutriScoreBadge score={item.nutriscore} />
          {!item.isShared && (
            <span className="font-mono text-2xs text-text-tertiary">PRIVÉ</span>
          )}
        </div>
        {item.brand && (
          <span className="font-body text-2xs text-text-tertiary">{item.brand}</span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="font-mono text-xs text-text-mono whitespace-nowrap">
          {item.quantity} {item.unit}
        </span>
        <ExpiryBadge days={item.daysUntilExpiry} />
      </div>
    </div>
  );
}

export function ZoneDetailPanel() {
  const { zoneDetail, isPanelOpen, isDetailLoading, closePanel } = useZoneDetail();

  const healthColor = zoneDetail
    ? HEALTH_COLORS[zoneDetail.healthStatus]
    : '#3a3d45';

  return (
    <>
      {/* Backdrop */}
      {isPanelOpen && (
        <div
          className="absolute inset-0 z-20 pointer-events-auto"
          onClick={closePanel}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={clsx(
          'absolute top-0 right-0 h-full w-80 z-30 pointer-events-auto',
          'transition-transform duration-300 ease-out',
          isPanelOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="panel h-full flex flex-col rounded-none rounded-l-xl overflow-hidden">
          {/* Header */}
          <div
            className="px-4 py-3 border-b border-surface-border flex items-center justify-between"
            style={{ borderLeftColor: healthColor, borderLeftWidth: 3 }}
          >
            <div>
              <div className="label-section">ZONE SÉLECTIONNÉE</div>
              <h2 className="font-display text-lg font-600 text-text-primary mt-0.5">
                {zoneDetail?.label ?? '—'}
              </h2>
            </div>
            <button
              onClick={closePanel}
              className="text-text-tertiary hover:text-text-primary transition-colors p-1"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Metrics row */}
          {zoneDetail && (
            <div className="px-4 py-2.5 border-b border-surface-border flex gap-4">
              <div>
                <div className="font-mono text-lg font-500" style={{ color: healthColor }}>
                  {zoneDetail.itemCount}
                </div>
                <div className="label-section">ITEMS</div>
              </div>
              <div>
                <div className="font-mono text-lg font-500 text-text-primary">
                  {Math.round(zoneDetail.fillRatio * 100)}%
                </div>
                <div className="label-section">REMPLI</div>
              </div>
              <div>
                <div className="font-mono text-lg font-500" style={{ color: healthColor }}>
                  {zoneDetail.nextExpiryDays !== null ? `J+${zoneDetail.nextExpiryDays}` : '—'}
                </div>
                <div className="label-section">PROCHAIN EXP.</div>
              </div>
              {/* Owner colors */}
              <div className="ml-auto flex flex-col items-end">
                <div className="flex gap-1 mt-0.5">
                  {zoneDetail.ownerColors.map((c) => (
                    <div
                      key={c}
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="label-section mt-1">PROPRIO</div>
              </div>
            </div>
          )}

          {/* Items list */}
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {isDetailLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="font-mono text-sm text-text-tertiary animate-pulse">
                  CHARGEMENT...
                </div>
              </div>
            ) : zoneDetail?.items.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="font-display text-4xl text-surface-border mb-2">∅</div>
                  <div className="font-mono text-xs text-text-tertiary">ZONE VIDE</div>
                </div>
              </div>
            ) : (
              <div>
                <div className="label-section mb-2">CONTENU</div>
                {zoneDetail?.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>

          {/* Footer — mesh ID for debug */}
          {zoneDetail && (
            <div className="px-4 py-2 border-t border-surface-border">
              <span className="badge-mono">{zoneDetail.meshId}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}