import { Toaster, toast } from 'sonner';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Toast System (sonner)
//
// STYLE : Industrial dark — fond #0f1114, bordure néon de la couleur du
// colocataire concerné, typography JetBrains Mono pour les données.
//
// USAGE :
//   import { toasts } from '@/components/ui/ToastProvider';
//   toasts.settle('Alice', '#6366F1', 42.50);
//   toasts.checkItem('Lait');
//   toasts.addItem('Pain de mie');
//   toasts.error('Message d'erreur');
//   toasts.financeRefresh();
// ─────────────────────────────────────────────────────────────────────────────

// ── Micro-son UI (inline, pas de dépendance externe) ─────────────────────────
// Joue un court son synthétique directement via Web Audio API.
// Séparé de useFridgeAudio pour éviter les imports circulaires.
function playBlip(type: 'success' | 'error' | 'warn'): void {
  try {
    // Ne joue rien si l'utilisateur a déjà coupé le son
    const storedMuted = (() => {
      try {
        const raw = localStorage.getItem('colocos-store');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed?.state?.isMuted === true;
      } catch { return false; }
    })();
    if (storedMuted) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    const freqMap  = { success: 1100, error: 320, warn: 660 } as const;
    const typeMap  = { success: 'sine', error: 'square', warn: 'triangle' } as const;
    const durMap   = { success: 0.022, error: 0.045, warn: 0.035 } as const;

    osc.type            = typeMap[type] as OscillatorType;
    osc.frequency.value = freqMap[type];
    g.gain.setValueAtTime(0.10, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durMap[type]);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durMap[type] + 0.005);
    // Auto-close the AudioContext after the sound finishes
    osc.onended = () => { ctx.close(); };
  } catch { /* silently fail if audio blocked */ }
}

// ── Toaster Component ─────────────────────────────────────────────────────────

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      offset={80}   // clearance pour la NavDock
      visibleToasts={4}
      toastOptions={{
        style: {
          background: '#0f1114',
          border: '1px solid #2a2d35',
          color: '#e8eaf0',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '12px',
          borderRadius: '10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
          padding: '10px 14px',
          gap: '8px',
        },
        duration: 3500,
      }}
      theme="dark"
      richColors={false}
    />
  );
}

// ── Toast factories ───────────────────────────────────────────────────────────
// Chaque fonction génère un toast avec la couleur néon du colocataire concerné.
// L'objet `style` inline permet de surcharger la bordure dynamiquement.

export const toasts = {
  /**
   * Remboursement confirmé : from → to
   * Bordure colorée avec la couleur du créancier
   */
  settle: (fromName: string, toName: string, amount: number, toColorHex: string) => {
    playBlip('success');
    toast.success(`Virement confirmé`, {
      description: `${fromName} → ${toName}   ${amount.toFixed(2)}€`,
      style: {
        background: '#0f1114',
        border: `1px solid ${toColorHex}55`,
        boxShadow: `0 0 20px ${toColorHex}20, 0 8px 32px rgba(0,0,0,0.6)`,
        color: '#e8eaf0',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      icon: '✓',
      duration: 4000,
    });
  },

  /**
   * Item coché dans la liste de courses
   */
  checkItem: (itemName: string) => {
    toast(`${itemName}`, {
      description: 'Coché dans la liste',
      style: {
        background: '#0f1114',
        border: '1px solid #00e67640',
        boxShadow: '0 0 16px #00e67615, 0 8px 32px rgba(0,0,0,0.6)',
        color: '#e8eaf0',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      icon: '✓',
      duration: 2000,
    });
  },

  /**
   * Item ajouté à la liste de courses
   */
  addItem: (itemName: string, addedByColor?: string) => {
    const borderColor = addedByColor ? `${addedByColor}55` : '#4fc3f740';
    const glowColor   = addedByColor ? `${addedByColor}15` : '#4fc3f715';
    toast(`Ajouté : ${itemName}`, {
      style: {
        background: '#0f1114',
        border: `1px solid ${borderColor}`,
        boxShadow: `0 0 16px ${glowColor}, 0 8px 32px rgba(0,0,0,0.6)`,
        color: '#e8eaf0',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      icon: '+',
      duration: 2500,
    });
  },

  /**
   * Dépense enregistrée
   */
  addExpense: (description: string, amount: number, payerColor: string) => {
    toast(`Dépense enregistrée`, {
      description: `${description}   ${amount.toFixed(2)}€`,
      style: {
        background: '#0f1114',
        border: `1px solid ${payerColor}55`,
        boxShadow: `0 0 20px ${payerColor}20, 0 8px 32px rgba(0,0,0,0.6)`,
        color: '#e8eaf0',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      icon: '€',
      duration: 3500,
    });
  },

  /**
   * Porte du frigo : état changé
   */
  doorState: (open: boolean) => {
    toast(open ? 'Frigo ouvert' : 'Frigo fermé', {
      style: {
        background: '#0f1114',
        border: open ? '1px solid #4fc3f740' : '1px solid #2a2d35',
        color: '#8b8fa8',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '11px',
        borderRadius: '10px',
        padding: '8px 12px',
      },
      duration: 1500,
    });
  },

  /**
   * Erreur générique — bordure rouge
   */
  error: (message: string, description?: string) => {
    playBlip('error');
    toast.error(message, {
      description,
      style: {
        background: '#0f1114',
        border: '1px solid #ff3b3b55',
        boxShadow: '0 0 20px #ff3b3b15, 0 8px 32px rgba(0,0,0,0.6)',
        color: '#e8eaf0',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      duration: 5000,
    });
  },

  /**
   * Info neutre
   */
  info: (message: string, description?: string) => {
    toast(message, {
      description,
      style: {
        background: '#0f1114',
        border: '1px solid #2a2d35',
        color: '#8b8fa8',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      duration: 3000,
    });
  },

  /**
   * Scanner — produit ajouté à l'inventaire
   */
  productAdded: (name: string, zone: string) => {
    playBlip('success');
    toast.success(`${name}`, {
      description: `Rangé dans : ${zone}`,
      style: {
        background: '#0f1114',
        border: '1px solid #00e67640',
        boxShadow: '0 0 20px #00e67615, 0 8px 32px rgba(0,0,0,0.6)',
        color: '#e8eaf0',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      icon: '📦',
      duration: 4000,
    });
  },

  /**
   * Scanner — produit non reconnu
   */
  productNotFound: (barcode: string) => {
    toast(`Scanner : Produit non reconnu`, {
      description: `Code-barres : ${barcode}`,
      style: {
        background: '#0f1114',
        border: '1px solid #ff950040',
        boxShadow: '0 0 20px #ff950015, 0 8px 32px rgba(0,0,0,0.6)',
        color: '#e8eaf0',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      icon: '⚠',
      duration: 4000,
    });
  },

  /**
   * Recette ajoutée aux favoris
   */
  recipeFavorited: (title: string) => {
    playBlip('success');
    toast.success(`${title} ajoutée à vos favoris !`, {
      style: {
        background: '#0f1114',
        border: '1px solid #f59e0b55',
        boxShadow: '0 0 24px #f59e0b18, 0 8px 32px rgba(0,0,0,0.6)',
        color: '#e8eaf0',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      icon: '★',
      duration: 3500,
    });
  },

  /**
   * Recette retirée des favoris
   */
  recipeUnfavorited: (title: string) => {
    toast(`${title} retirée des favoris`, {
      style: {
        background: '#0f1114',
        border: '1px solid #2a2d35',
        color: '#8b8fa8',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '12px',
        borderRadius: '10px',
      },
      icon: '☆',
      duration: 2500,
    });
  },
};

// Re-export sonner toast for raw access if needed
export { toast };