import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Refrigerator, Wallet, ShoppingCart, Scan, ChefHat } from 'lucide-react';
import clsx from 'clsx';
import { useNavStore, useFridgeStore, useFinanceStore, useShoppingStore } from '@/store';
import { FinanceModule } from './FinanceModule';
import { ShoppingModule } from './ShoppingModule';
import { ScannerModule } from './ScannerModule';
import { RecipeModule } from './RecipeModule';
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
        'relative flex flex-col items-center gap-0.5 px-3.5 py-2.5 rounded-lg',
        'transition-all duration-200 select-none focus:outline-none',
        isActive ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
      )}
    >
      <div className="relative">
        {item.icon}
        {item.badgeCount != null && item.badgeCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full
                       bg-health-critical flex items-center justify-center"
          >
            <span className="font-mono text-[8px] text-white leading-none">
              {item.badgeCount > 9 ? '9+' : item.badgeCount}
            </span>
          </motion.div>
        )}
      </div>
      <span className="font-display text-[9px] tracking-widest font-500 leading-none">
        {item.label}
      </span>
    </button>
  );
}

// ── Module Panel ─────────────────────────────────────────────────────────────

const PANEL_VARIANTS = {
  hidden:  { opacity: 0, y: 32, scale: 0.98 },
  visible: { opacity: 1, y: 0,  scale: 1 },
  exit:    { opacity: 0, y: 24, scale: 0.97 },
};

// Accent color per module for the panel top-edge line
const MODULE_ACCENT: Record<string, string> = {
  finance:  '#4fc3f760',
  shopping: '#f59e0b60',
  scanner:  '#00e67660',
  recipes:  '#a78bfa60',
};

function ModulePanel({ module }: { module: AppModule }) {
  if (module === 'fridge') return null;

  const accentGrad = MODULE_ACCENT[module] ?? '#4fc3f760';

  return (
    <motion.div
      key={module}
      variants={PANEL_VARIANTS}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="absolute bottom-[72px] left-2 right-2 rounded-xl overflow-hidden"
      style={{
        maxHeight: 'calc(100vh - 156px)',
        background: 'linear-gradient(160deg, #14161a 0%, #0f1114 100%)',
        border: '1px solid #2a2d35',
        boxShadow: '0 -8px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Decorative top edge line */}
      <div
        className="h-px w-full flex-shrink-0"
        style={{ background: `linear-gradient(90deg, transparent, ${accentGrad}, transparent)` }}
      />

      <div
        className="overflow-y-auto p-4"
        style={{ maxHeight: 'calc(100vh - 172px)' }}
      >
        {module === 'finance'  && <FinanceModule />}
        {module === 'shopping' && <ShoppingModule />}
        {module === 'scanner'  && <ScannerModule />}
        {module === 'recipes'  && <RecipeModule />}
      </div>
    </motion.div>
  );
}

// ── Main NavDock ──────────────────────────────────────────────────────────────

export function NavDock() {
  const { activeModule, setActiveModule } = useNavStore();
  const { fridgeState } = useFridgeStore();
  const { financeStatus } = useFinanceStore();
  const { shoppingList } = useShoppingStore();

  const criticalCount  = fridgeState?.summary.criticalZones ?? 0;
  const debtCount      = financeStatus?.simplifiedDebts.length ?? null;
  const pendingItems   = shoppingList?.items.filter(i => i.status === 'pending').length ?? null;

  const navItems: NavItem[] = [
    {
      id: 'fridge',
      label: 'FRIGO',
      icon: <Refrigerator size={16} strokeWidth={1.5} />,
      badgeCount: criticalCount > 0 ? criticalCount : null,
    },
    {
      id: 'finance',
      label: 'FINANCE',
      icon: <Wallet size={16} strokeWidth={1.5} />,
      badgeCount: debtCount,
    },
    {
      id: 'shopping',
      label: 'COURSES',
      icon: <ShoppingCart size={16} strokeWidth={1.5} />,
      badgeCount: pendingItems,
    },
    {
      id: 'scanner',
      label: 'SCAN',
      icon: <Scan size={16} strokeWidth={1.5} />,
    },
    {
      id: 'recipes',
      label: 'RECETTES',
      icon: <ChefHat size={16} strokeWidth={1.5} />,
    },
  ];

  const handleTabClick = (id: AppModule) => {
    if (id === activeModule && id !== 'fridge') {
      setActiveModule('fridge');
    } else {
      setActiveModule(id);
    }
  };

  const activeIndex = navItems.findIndex(n => n.id === activeModule);

  return (
    <>
      {/* ── Module Panels ─────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeModule !== 'fridge' && (
          <ModulePanel key={activeModule} module={activeModule} />
        )}
      </AnimatePresence>

      {/* ── Dock Bar ─────────────────────────────────────────────────────── */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, type: 'spring', stiffness: 300, damping: 28 }}
          className="relative flex items-center rounded-2xl px-1 py-1"
          style={{
            background: 'rgba(14,16,20,0.90)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(42,45,53,0.8)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {/* Sliding active indicator pill — width/position based on 5 items */}
          <motion.div
            className="absolute top-1 bottom-1 rounded-xl"
            style={{ background: 'rgba(79,195,247,0.08)', border: '1px solid rgba(79,195,247,0.18)' }}
            animate={{
              left: `calc(${activeIndex} * (100% / 5) + 4px)`,
              width: `calc(100% / 5 - 8px)`,
            }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />

          {navItems.map(item => (
            <NavTab
              key={item.id}
              item={item}
              isActive={activeModule === item.id}
              onClick={() => handleTabClick(item.id)}
            />
          ))}
        </motion.div>
      </div>
    </>
  );
}