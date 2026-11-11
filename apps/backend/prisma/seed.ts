import { PrismaClient, StorageType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Initialisation ColocOS — Démarrage à blanc...\n');

  // ── 1. Tes potes et toi ───────────────────────────────────────────────────
  // Modifie simplement les prénoms et emails ici :
  const roommates = [
    { name: 'Mattéo Bombrun',  email: 'matteo@colocos.local',  colorHex: '#3B82F6' },
    { name: 'Mattéo Bergeron', email: 'pote1@colocos.local',   colorHex: '#10B981' },
    { name: 'Tom Valette',  email: 'pote2@colocos.local',   colorHex: '#F59E0B' },
    { name: 'Aymeric Bonnans',  email: 'pote3@colocos.local',   colorHex: '#EC4899' },
    { name: 'Mathys Gerrer',  email: 'pote4@colocos.local',   colorHex: '#8B5CF6' },
    { name: 'Roméo Blanchet',  email: 'pote5@colocos.local',   colorHex: '#EF4444' },
    { name: 'Corentin Haverlant',  email: 'pote6@colocos.local',   colorHex: '#E08544' },
  ];

  // Mot de passe unique par défaut pour tout le monde en dev
  const defaultPassword = await bcrypt.hash('coloc2026', 10);

  const users = await Promise.all(
    roommates.map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, colorHex: u.colorHex },
        create: { ...u, password: defaultPassword },
      })
    )
  );
  console.log(`✅ ${users.length} colocataires créés (mot de passe par défaut : coloc2026)`);

  // ── 2. Zones physiques indispensables au Digital Twin CAD ──────────────────
  const zoneDefinitions = [
    { meshId: 'fridge_shelf_top',       label: 'Frigo — Étagère haute',        type: StorageType.fridge,   capacityLiters: 18, positionX: 0.0,  positionY: 1.4,  positionZ: 0.3  },
    { meshId: 'fridge_shelf_middle',    label: 'Frigo — Étagère milieu',       type: StorageType.fridge,   capacityLiters: 20, positionX: 0.0,  positionY: 1.1,  positionZ: 0.3  },
    { meshId: 'fridge_shelf_bottom',    label: 'Frigo — Étagère basse',        type: StorageType.fridge,   capacityLiters: 20, positionX: 0.0,  positionY: 0.8,  positionZ: 0.3  },
    { meshId: 'fridge_crisper_left',    label: 'Frigo — Bac légumes gauche',   type: StorageType.fridge,   capacityLiters: 10, positionX: -0.2, positionY: 0.35, positionZ: 0.3  },
    { meshId: 'fridge_crisper_right',   label: 'Frigo — Bac légumes droit',    type: StorageType.fridge,   capacityLiters: 10, positionX: 0.2,  positionY: 0.35, positionZ: 0.3  },
    { meshId: 'fridge_door_shelf_1',    label: 'Frigo — Porte haut',           type: StorageType.fridge,   capacityLiters: 8,  positionX: 0.0,  positionY: 1.3,  positionZ: -0.3 },
    { meshId: 'fridge_door_shelf_2',    label: 'Frigo — Porte milieu',         type: StorageType.fridge,   capacityLiters: 8,  positionX: 0.0,  positionY: 1.0,  positionZ: -0.3 },
    { meshId: 'fridge_door_shelf_3',    label: 'Frigo — Porte bas / beurre',   type: StorageType.fridge,   capacityLiters: 3,  positionX: 0.0,  positionY: 0.7,  positionZ: -0.3 },
    { meshId: 'fridge_shelf_crisper_cover', label: 'Frigo — Dessus bac à légumes', type: StorageType.fridge, capacityLiters: 8, positionX: 0.0, positionY: 1.0, positionZ: -0.3 },
    { meshId: 'fridge_rack_bottles',        label: 'Frigo — Range-bouteilles',     type: StorageType.fridge, capacityLiters: 6, positionX: 0.0, positionY: 0.75, positionZ: -0.3 },
    // Porte — 8 bacs discrets de l'assemblage Onshape `fridge_door_assembly`
    { meshId: 'fridge_door_left_1',  label: 'Frigo — Porte G. Haut',       type: StorageType.fridge, capacityLiters: 5, positionX: 0.0, positionY: 1.3, positionZ: -0.3 },
    { meshId: 'fridge_door_left_2',  label: 'Frigo — Porte G. Milieu',     type: StorageType.fridge, capacityLiters: 5, positionX: 0.0, positionY: 1.1, positionZ: -0.3 },
    { meshId: 'fridge_door_left_3',  label: 'Frigo — Porte G. Bas',        type: StorageType.fridge, capacityLiters: 4, positionX: 0.0, positionY: 0.9, positionZ: -0.3 },
    { meshId: 'fridge_door_right_1', label: 'Frigo — Porte D. Étage 1',    type: StorageType.fridge, capacityLiters: 4, positionX: 0.0, positionY: 1.3, positionZ: -0.3 },
    { meshId: 'fridge_door_right_2', label: 'Frigo — Porte D. Étage 2',    type: StorageType.fridge, capacityLiters: 4, positionX: 0.0, positionY: 1.1, positionZ: -0.3 },
    { meshId: 'fridge_door_right_3', label: 'Frigo — Porte D. Étage 3',    type: StorageType.fridge, capacityLiters: 4, positionX: 0.0, positionY: 0.9, positionZ: -0.3 },
    { meshId: 'fridge_door_right_4', label: 'Frigo — Porte D. Étage 4',    type: StorageType.fridge, capacityLiters: 4, positionX: 0.0, positionY: 0.7, positionZ: -0.3 },
    { meshId: 'fridge_door_bottom',  label: 'Frigo — Porte Bac inférieur', type: StorageType.fridge, capacityLiters: 3, positionX: 0.0, positionY: 0.55, positionZ: -0.3 },
    { meshId: 'freezer_drawer_1',       label: 'Congélateur — Tiroir 1',       type: StorageType.freezer,  capacityLiters: 15, positionX: 0.0,  positionY: 0.15, positionZ: 0.3  },
    { meshId: 'freezer_drawer_2',       label: 'Congélateur — Tiroir 2',       type: StorageType.freezer,  capacityLiters: 15, positionX: 0.0,  positionY: 0.05, positionZ: 0.3  },
    { meshId: 'cabinet_left_shelf_1',   label: 'Placard gauche — Haut',        type: StorageType.cabinet,  capacityLiters: 30, positionX: -0.8, positionY: 1.8,  positionZ: 0.0  },
    { meshId: 'cabinet_left_shelf_2',   label: 'Placard gauche — Bas',         type: StorageType.cabinet,  capacityLiters: 30, positionX: -0.8, positionY: 1.4,  positionZ: 0.0  },
    { meshId: 'cabinet_right_shelf_1',  label: 'Placard droit — Haut',         type: StorageType.cabinet,  capacityLiters: 30, positionX: 0.8,  positionY: 1.8,  positionZ: 0.0  },
    { meshId: 'cabinet_right_shelf_2',  label: 'Placard droit — Bas',          type: StorageType.cabinet,  capacityLiters: 30, positionX: 0.8,  positionY: 1.4,  positionZ: 0.0  },
    { meshId: 'pantry_shelf_1',         label: 'Garde-manger — Étagère 1',     type: StorageType.pantry,   capacityLiters: 50, positionX: 1.5,  positionY: 1.5,  positionZ: 0.0  },
    { meshId: 'pantry_shelf_2',         label: 'Garde-manger — Étagère 2',     type: StorageType.pantry,   capacityLiters: 50, positionX: 1.5,  positionY: 1.0,  positionZ: 0.0  },
  ];

  await Promise.all(
    zoneDefinitions.map((z) =>
      prisma.storageZone.upsert({
        where: { meshId: z.meshId },
        update: { label: z.label, capacityLiters: z.capacityLiters },
        create: z,
      })
    )
  );
  console.log(`✅ ${zoneDefinitions.length} zones physiques prêtes`);

  // ── 3. Nettoyage absolu de tout faux contenu ──────────────────────────────
  await prisma.item.deleteMany({});
  await prisma.shoppingItem.deleteMany({});
  await prisma.expenseSplit.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.transaction.deleteMany({});

  // ── 4. Liste de courses vierge ─────────────────────────────────────────────
  await prisma.shoppingList.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { name: 'Liste de courses' },
    create: { id: '00000000-0000-0000-0000-000000000001', name: 'Liste de courses' },
  });

  console.log('\n✨ Base de données réinitialisée à 100% à blanc.');
  console.log('   → 0 aliment');
  console.log('   → 0 dépense');
  console.log('   → Frigo 3D prêt pour l\'ajout de vrais produits scannés !\n');
}

main()
  .catch((e) => {
    console.error('❌ Erreur de seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());