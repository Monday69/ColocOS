import { motion } from 'framer-motion';
import { Refrigerator, Wallet, ShoppingCart, Scan, ChefHat } from 'lucide-react';
import clsx from 'clsx';
import { useNavStore, useFridgeStore, useFinanceStore, useShoppingStore, useUIStore } from '@/store';
import { hapticTap } from '@/lib/haptics';
import type { AppModule } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — NavDock v2 (Sprint 7 — Scanner + Recipes)
//
// 5 modules : FRIGO · FINANCES · COURSES · SCANNER · RECETTES
//
// Pill indicator adapté : width = 100%/5 per tab
// Panel dimensions adjustées pour les nouveaux modules :
//   Scanner → panel étroit (max-w-sm centré)
//   Recettes → panel plein-largeur (max-w-2xl) pour la grille 2 colonnes
// ─────────────────────────────────────────────────────────────────────────────

interface NavItem {
  id: AppModule;
  label: string;
  icon: React.ReactNode;
  badgeCount?: number | null;
}

function NavTab({
  item,
  isActive,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative flex-1 flex flex-col items-center px-1 pt-0.5 pb-0 rounded-lg',
        // Retour tactile immédiat (iOS) + courbe de sortie douce
        'tap ease-ios select-none focus:outline-none',
        isActive ? 'text-cyan-400 font-semibold' : 'text-slate-400/80 hover:text-slate-200',
      )}
    >
      {/* Liseré supérieur 2 px (onglet actif) — remplace la pilule opaque */}
      {isActive && (
        <motion.span
          layoutId="dock-active-edge"
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full bg-cyan-400"
          style={{ boxShadow: '0 0 8px rgba(34,211,238,0.75)' }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <div className="relative">
        {item.icon}
        {item.badgeCount != null && item.badgeCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
            className="absolute -top-1.5 -right-2 min-w-3.5 h-3.5 px-1 rounded-full
                       bg-health-critical flex items-center justify-center
                       ring-1 ring-white/20 tabular-nums"
          >
            <span className="font-mono text-[9px] text-white leading-none tabular-nums">
              {item.badgeCount > 9 ? '9+' : item.badgeCount}
            </span>
          </motion.div>
        )}
      </div>
      <span className="font-sans text-[10.5px] font-medium tracking-wide uppercase leading-none mt-0.5">
        {item.label}
      </span>
    </button>
  );
}

// ── Main NavDock ──────────────────────────────────────────────────────────────

export function NavDock() {
  const { activeModule, setActiveModule } = useNavStore();
  const isIntroActive = useUIStore((s) => s.isIntroActive);
  const introUiReady = useUIStore((s) => s.introUiReady);
  const uiHidden = isIntroActive && !introUiReady;
  const { fridgeState } = useFridgeStore();
  const { financeStatus } = useFinanceStore();
  const { shoppingList } = useShoppingStore();

  const criticalCount  = fridgeState?.summary.criticalZones ?? 0;
  const debtCount      = financeStatus?.simplifiedDebts.length ?? null;
  const pendingItems   = shoppingList?.items.filter(i => i.status === 'pending').length ?? null;

  // Ordre valide : FRIGO au centre, encadre par Finance/Courses et Scan/Recettes
  const navItems: NavItem[] = [
    {
      id: 'finance',
      label: 'FINANCE',
      icon: <Wallet size={23} strokeWidth={1.5} />,
      badgeCount: debtCount,
    },
    {
      id: 'shopping',
      label: 'COURSES',
      icon: <ShoppingCart size={23} strokeWidth={1.5} />,
      badgeCount: pendingItems,
    },
    {
      id: 'fridge',
      label: 'FRIGO',
      icon: <Refrigerator size={23} strokeWidth={1.5} />,
      badgeCount: criticalCount > 0 ? criticalCount : null,
    },
    {
      id: 'scanner',
      label: 'SCAN',
      icon: <Scan size={23} strokeWidth={1.5} />,
    },
    {
      id: 'recipes',
      label: 'RECETTES',
      icon: <ChefHat size={23} strokeWidth={1.5} />,
    },
  ];


  const handleTabClick = (id: AppModule) => {
    hapticTap();
    if (id === activeModule && id !== 'fridge') {
      setActiveModule('fridge');
    } else {
      setActiveModule(id);
    }
  };

  return (
    <>
      {/* ── Barre de navigation edge-to-edge (iOS) ───────────────────────────
          Pleine largeur, collée au bord physique, le Home Indicator est
          absorbé par le padding bas en env(safe-area-inset-bottom). */}
      <nav
        className={`fixed inset-x-0 bottom-0 w-full z-40 pointer-events-auto transition-opacity duration-500 ${
          uiHidden ? 'opacity-0' : 'opacity-100'
        } bg-slate-950/60 backdrop-blur-md border-t border-white/10 px-3 flex items-center justify-around`}
        aria-label="Navigation principale"
        // Le conteneur touche le bord physique : le padding bas repousse les
        // libelles au-dessus du trait du Home Indicator (14-16 px)
        style={{
          bottom: 0,
          paddingTop: '6px',
          paddingBottom: 'max(14px, env(safe-area-inset-bottom, 16px))',
        }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
          className="relative flex items-center justify-around max-w-lg mx-auto w-full"
        >
          {navItems.map(item => (
            <NavTab
              key={item.id}
              item={item}
              isActive={activeModule === item.id}
              onClick={() => handleTabClick(item.id)}
            />
          ))}
        </motion.div>
      </nav>
    </>
  );
}