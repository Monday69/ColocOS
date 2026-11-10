import type { ReactNode } from 'react';
import type { AppModule } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Écran plein format natif iOS
//
// Les modules ne sont plus des popovers flottants au-dessus de la 3D : ce
// conteneur occupe tout l'écran (fixed inset-0), gère la safe-area supérieure
// et laisse la barre d'onglets (z-40) accessible en bas.
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<AppModule, string> = {
  fridge: 'Frigo',
  finance: 'Finance',
  shopping: 'Courses',
  scanner: 'Scanner',
  recipes: 'Recettes',
};

interface ModuleScreenProps {
  module: AppModule;
  children: ReactNode;
}

export function ModuleScreen({ module, children }: ModuleScreenProps) {
  return (
    <section
      className="fixed inset-0 w-full h-dvh bg-slate-950 flex flex-col z-20"
      aria-label={`Module ${MODULE_LABELS[module]}`}
      data-module={module}
    >
      {/* En-tête géré par le module lui-même ; on lui laisse la safe-area et
          une marge haute cohérente avec le HUD du frigo. */}
      <main
        className="flex-1 min-h-0 overflow-hidden px-4
                   pt-[calc(env(safe-area-inset-top,47px)+1.5rem)]
                   pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]"
      >
        {children}
      </main>
    </section>
  );
}
