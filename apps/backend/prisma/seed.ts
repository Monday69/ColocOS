import { PrismaClient, StorageType, Unit } from '@prisma/client';
import bcrypt from 'bcryptjs';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Seed de démonstration
//
// OBJECTIF : Couvrir tous les états du Digital Twin dès le premier lancement.
//
// Zones et états ciblés :
//   fridge_shelf_top      → healthStatus: CRITICAL  (item expire demain)
//   fridge_shelf_middle   → healthStatus: WARNING   (item expire dans 5 jours)
//   fridge_shelf_bottom   → healthStatus: OK        (items sains)
//   fridge_door_shelf_1   → fillStatus:   FULL      (étagère pleine)
//   fridge_crisper_left   → fillStatus:   LOW       (presque vide)
//   fridge_crisper_right  → healthStatus: EMPTY     (aucun item)
//   freezer_drawer_1      → healthStatus: OK        (surgelés)
//   cabinet_left_shelf_1  → healthStatus: OK        (épicerie sèche)
//   cabinet_right_shelf_1 → healthStatus: WARNING   (item proche expiration)
//   pantry_shelf_1        → fillStatus:   MEDIUM    (bien rempli)
// ─────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  console.log('🌱 Seeding ColocOS — Digital Twin Demo...\n');

  // ── 1. Colocataires ───────────────────────────────────────────────────────
  const roommateData = [
    { name: 'Alice',   email: 'alice@colocos.local',   colorHex: '#6366F1' },
    { name: 'Bob',     email: 'bob@colocos.local',     colorHex: '#EC4899' },
    { name: 'Charlie', email: 'charlie@colocos.local', colorHex: '#F59E0B' },
    { name: 'Diana',   email: 'diana@colocos.local',   colorHex: '#10B981' },
    { name: 'Eric',    email: 'eric@colocos.local',    colorHex: '#3B82F6' },
    { name: 'Fatima',  email: 'fatima@colocos.local',  colorHex: '#EF4444' },
  ];

  const hashedPassword = await bcrypt.hash('password123', 12);

  const users = await Promise.all(
    roommateData.map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: { ...u, password: hashedPassword },
      }),
    ),
  );
  const [alice, bob, charlie, diana, eric, fatima] = users;
  console.log(`✅ ${users.length} colocataires créés`);

  // ── 2. Zones de stockage ──────────────────────────────────────────────────
  const zoneDefinitions = [
    { meshId: 'fridge_shelf_top',       label: 'Frigo — Étagère haute',        type: StorageType.fridge,   capacityLiters: 18, positionX: 0.0,  positionY: 1.4,  positionZ: 0.3  },
    { meshId: 'fridge_shelf_middle',    label: 'Frigo — Étagère milieu',       type: StorageType.fridge,   capacityLiters: 20, positionX: 0.0,  positionY: 1.1,  positionZ: 0.3  },
    { meshId: 'fridge_shelf_bottom',    label: 'Frigo — Étagère basse',        type: StorageType.fridge,   capacityLiters: 20, positionX: 0.0,  positionY: 0.8,  positionZ: 0.3  },
    { meshId: 'fridge_crisper_left',    label: 'Frigo — Bac légumes gauche',   type: StorageType.fridge,   capacityLiters: 10, positionX: -0.2, positionY: 0.35, positionZ: 0.3  },
    { meshId: 'fridge_crisper_right',   label: 'Frigo — Bac légumes droit',    type: StorageType.fridge,   capacityLiters: 10, positionX: 0.2,  positionY: 0.35, positionZ: 0.3  },
    { meshId: 'fridge_door_shelf_1',    label: 'Frigo — Porte haut',           type: StorageType.fridge,   capacityLiters: 8,  positionX: 0.0,  positionY: 1.3,  positionZ: -0.3 },
    { meshId: 'fridge_door_shelf_2',    label: 'Frigo — Porte milieu',         type: StorageType.fridge,   capacityLiters: 8,  positionX: 0.0,  positionY: 1.0,  positionZ: -0.3 },
    { meshId: 'fridge_door_shelf_3',    label: 'Frigo — Porte beurre',         type: StorageType.fridge,   capacityLiters: 3,  positionX: 0.0,  positionY: 0.7,  positionZ: -0.3 },
    { meshId: 'freezer_drawer_1',       label: 'Congélateur — Tiroir 1',       type: StorageType.freezer,  capacityLiters: 15, positionX: 0.0,  positionY: 0.15, positionZ: 0.3  },
    { meshId: 'freezer_drawer_2',       label: 'Congélateur — Tiroir 2',       type: StorageType.freezer,  capacityLiters: 15, positionX: 0.0,  positionY: 0.05, positionZ: 0.3  },
    { meshId: 'cabinet_left_shelf_1',   label: 'Placard gauche — Haut',        type: StorageType.cabinet,  capacityLiters: 30, positionX: -0.8, positionY: 1.8,  positionZ: 0.0  },
    { meshId: 'cabinet_left_shelf_2',   label: 'Placard gauche — Bas',         type: StorageType.cabinet,  capacityLiters: 30, positionX: -0.8, positionY: 1.4,  positionZ: 0.0  },
    { meshId: 'cabinet_right_shelf_1',  label: 'Placard droit — Haut',         type: StorageType.cabinet,  capacityLiters: 30, positionX: 0.8,  positionY: 1.8,  positionZ: 0.0  },
    { meshId: 'cabinet_right_shelf_2',  label: 'Placard droit — Bas',          type: StorageType.cabinet,  capacityLiters: 30, positionX: 0.8,  positionY: 1.4,  positionZ: 0.0  },
    { meshId: 'pantry_shelf_1',         label: 'Garde-manger — Étagère 1',     type: StorageType.pantry,   capacityLiters: 50, positionX: 1.5,  positionY: 1.5,  positionZ: 0.0  },
    { meshId: 'pantry_shelf_2',         label: 'Garde-manger — Étagère 2',     type: StorageType.pantry,   capacityLiters: 50, positionX: 1.5,  positionY: 1.0,  positionZ: 0.0  },
  ];

  const createdZones = await Promise.all(
    zoneDefinitions.map((z) =>
      prisma.storageZone.upsert({
        where: { meshId: z.meshId },
        update: { label: z.label, positionX: z.positionX, positionY: z.positionY, positionZ: z.positionZ },
        create: z,
      }),
    ),
  );

  const z = Object.fromEntries(createdZones.map((zone) => [zone.meshId, zone]));
  console.log(`✅ ${createdZones.length} zones créées`);

  // ── 3. Items (supprime + recrée pour seed idempotent) ─────────────────────
  await prisma.item.deleteMany({});

  const items = [
    // fridge_shelf_top → CRITICAL
    { name: 'Poulet rôti',           brand: 'Carrefour Bio',  quantity: 300, unit: Unit.g,    expiryDate: daysFromNow(1),   nutriscore: 'B', storageZoneId: z['fridge_shelf_top'].id,      ownerId: alice.id,   isShared: true  },
    { name: 'Soupe de légumes',      brand: null,             quantity: 500, unit: Unit.ml,   expiryDate: daysFromNow(-1),  nutriscore: 'A', storageZoneId: z['fridge_shelf_top'].id,      ownerId: bob.id,     isShared: true  },
    // fridge_shelf_middle → WARNING
    { name: 'Lait demi-écrémé',      brand: 'Lactel',         quantity: 1,   unit: Unit.L,    expiryDate: daysFromNow(5),   nutriscore: 'B', storageZoneId: z['fridge_shelf_middle'].id,   ownerId: alice.id,   isShared: true  },
    { name: 'Yaourt nature x4',      brand: 'Danone',         quantity: 4,   unit: Unit.unit, expiryDate: daysFromNow(12),  nutriscore: 'B', storageZoneId: z['fridge_shelf_middle'].id,   ownerId: alice.id,   isShared: false },
    { name: 'Fromage râpé',          brand: "Elle & Vire",    quantity: 200, unit: Unit.g,    expiryDate: daysFromNow(6),   nutriscore: 'C', storageZoneId: z['fridge_shelf_middle'].id,   ownerId: charlie.id, isShared: true  },
    // fridge_shelf_bottom → OK
    { name: "Jus d'orange",          brand: 'Tropicana',      quantity: 1,   unit: Unit.L,    expiryDate: daysFromNow(30),  nutriscore: 'C', storageZoneId: z['fridge_shelf_bottom'].id,   ownerId: diana.id,   isShared: true  },
    { name: 'Crème fraîche',         brand: 'Président',      quantity: 200, unit: Unit.ml,   expiryDate: daysFromNow(18),  nutriscore: 'D', storageZoneId: z['fridge_shelf_bottom'].id,   ownerId: diana.id,   isShared: true  },
    { name: 'Oeufs frais x6',        brand: 'Fermier',        quantity: 6,   unit: Unit.unit, expiryDate: daysFromNow(21),  nutriscore: 'B', storageZoneId: z['fridge_shelf_bottom'].id,   ownerId: eric.id,    isShared: true  },
    // fridge_crisper_left → LOW
    { name: 'Carotte',               brand: null,             quantity: 2,   unit: Unit.unit, expiryDate: daysFromNow(10),  nutriscore: 'A', storageZoneId: z['fridge_crisper_left'].id,   ownerId: fatima.id,  isShared: true  },
    // fridge_crisper_right → EMPTY (pas d'item)
    // fridge_door_shelf_1 → FULL (8 items pour dépasser 8L)
    { name: 'Lait entier',           brand: 'Lactel',         quantity: 1,   unit: Unit.L,    expiryDate: daysFromNow(14),  nutriscore: 'B', storageZoneId: z['fridge_door_shelf_1'].id,   ownerId: alice.id,   isShared: true  },
    { name: 'Jus de pomme',          brand: 'Tropicana',      quantity: 1,   unit: Unit.L,    expiryDate: daysFromNow(25),  nutriscore: 'C', storageZoneId: z['fridge_door_shelf_1'].id,   ownerId: bob.id,     isShared: true  },
    { name: 'Eau pétillante',        brand: 'Perrier',        quantity: 1,   unit: Unit.L,    expiryDate: daysFromNow(180), nutriscore: 'A', storageZoneId: z['fridge_door_shelf_1'].id,   ownerId: charlie.id, isShared: true  },
    { name: 'Kombucha',              brand: 'Lo Bros',        quantity: 500, unit: Unit.ml,   expiryDate: daysFromNow(45),  nutriscore: 'B', storageZoneId: z['fridge_door_shelf_1'].id,   ownerId: diana.id,   isShared: false },
    { name: 'Limonade',              brand: null,             quantity: 750, unit: Unit.ml,   expiryDate: daysFromNow(60),  nutriscore: 'D', storageZoneId: z['fridge_door_shelf_1'].id,   ownerId: eric.id,    isShared: true  },
    { name: 'Lait de coco',          brand: 'Aroy-D',         quantity: 400, unit: Unit.ml,   expiryDate: daysFromNow(90),  nutriscore: 'C', storageZoneId: z['fridge_door_shelf_1'].id,   ownerId: fatima.id,  isShared: true  },
    { name: 'Sauce soja',            brand: 'Kikkoman',       quantity: 250, unit: Unit.ml,   expiryDate: daysFromNow(365), nutriscore: null, storageZoneId: z['fridge_door_shelf_1'].id,  ownerId: alice.id,   isShared: true  },
    { name: 'Ketchup',               brand: 'Heinz',          quantity: 500, unit: Unit.ml,   expiryDate: daysFromNow(120), nutriscore: 'D', storageZoneId: z['fridge_door_shelf_1'].id,   ownerId: bob.id,     isShared: true  },
    // fridge_door_shelf_2 → OK multi-proprio
    { name: 'Moutarde',              brand: 'Amora',          quantity: 200, unit: Unit.g,    expiryDate: daysFromNow(90),  nutriscore: 'B', storageZoneId: z['fridge_door_shelf_2'].id,   ownerId: charlie.id, isShared: true  },
    { name: 'Mayonnaise',            brand: "Hellmann's",     quantity: 300, unit: Unit.g,    expiryDate: daysFromNow(45),  nutriscore: 'D', storageZoneId: z['fridge_door_shelf_2'].id,   ownerId: diana.id,   isShared: false },
    { name: 'Beurre demi-sel',       brand: 'Président',      quantity: 250, unit: Unit.g,    expiryDate: daysFromNow(60),  nutriscore: 'C', storageZoneId: z['fridge_door_shelf_3'].id,   ownerId: eric.id,    isShared: true  },
    // freezer_drawer_1 → OK
    { name: 'Saumon surgelé',        brand: 'Picard',         quantity: 400, unit: Unit.g,    expiryDate: daysFromNow(180), nutriscore: 'A', storageZoneId: z['freezer_drawer_1'].id,      ownerId: alice.id,   isShared: true  },
    { name: 'Petits pois surgelés',  brand: 'Bonduelle',      quantity: 1,   unit: Unit.kg,   expiryDate: daysFromNow(365), nutriscore: 'A', storageZoneId: z['freezer_drawer_1'].id,      ownerId: bob.id,     isShared: true  },
    { name: 'Steak haché 5%',        brand: 'Charal',         quantity: 4,   unit: Unit.unit, expiryDate: daysFromNow(120), nutriscore: 'B', storageZoneId: z['freezer_drawer_1'].id,      ownerId: charlie.id, isShared: false },
    // cabinet_left_shelf_1 → OK
    { name: 'Pâtes spaghetti',       brand: 'Barilla',        quantity: 500, unit: Unit.g,    expiryDate: daysFromNow(365), nutriscore: 'B', storageZoneId: z['cabinet_left_shelf_1'].id,  ownerId: diana.id,   isShared: true  },
    { name: 'Riz basmati',           brand: "Uncle Ben's",    quantity: 1,   unit: Unit.kg,   expiryDate: daysFromNow(730), nutriscore: 'B', storageZoneId: z['cabinet_left_shelf_1'].id,  ownerId: eric.id,    isShared: true  },
    { name: 'Lentilles vertes',      brand: 'Jardin Bio',     quantity: 500, unit: Unit.g,    expiryDate: daysFromNow(547), nutriscore: 'A', storageZoneId: z['cabinet_left_shelf_1'].id,  ownerId: fatima.id,  isShared: true  },
    { name: 'Quinoa',                brand: 'Alter Eco',      quantity: 400, unit: Unit.g,    expiryDate: daysFromNow(400), nutriscore: 'A', storageZoneId: z['cabinet_left_shelf_1'].id,  ownerId: alice.id,   isShared: true  },
    // cabinet_right_shelf_1 → WARNING
    { name: 'Farine T55',            brand: 'Francine',       quantity: 1,   unit: Unit.kg,   expiryDate: daysFromNow(4),   nutriscore: 'C', storageZoneId: z['cabinet_right_shelf_1'].id, ownerId: bob.id,     isShared: true  },
    { name: 'Sucre en poudre',       brand: 'Béghin Say',     quantity: 750, unit: Unit.g,    expiryDate: daysFromNow(365), nutriscore: 'E', storageZoneId: z['cabinet_right_shelf_1'].id, ownerId: charlie.id, isShared: true  },
    // pantry_shelf_1 → MEDIUM
    { name: "Huile d'olive",         brand: 'Puget',          quantity: 750, unit: Unit.ml,   expiryDate: daysFromNow(365), nutriscore: 'B', storageZoneId: z['pantry_shelf_1'].id,        ownerId: diana.id,   isShared: true  },
    { name: 'Vinaigre balsamique',   brand: 'Ponti',          quantity: 500, unit: Unit.ml,   expiryDate: daysFromNow(730), nutriscore: 'B', storageZoneId: z['pantry_shelf_1'].id,        ownerId: eric.id,    isShared: true  },
    { name: 'Sauce tomate',          brand: 'Mutti',          quantity: 400, unit: Unit.g,    expiryDate: daysFromNow(730), nutriscore: 'A', storageZoneId: z['pantry_shelf_1'].id,        ownerId: fatima.id,  isShared: true  },
    { name: 'Thon en conserve',      brand: 'Saupiquet',      quantity: 3,   unit: Unit.unit, expiryDate: daysFromNow(365), nutriscore: 'B', storageZoneId: z['pantry_shelf_1'].id,        ownerId: alice.id,   isShared: true  },
    { name: 'Haricots blancs',       brand: 'Cassegrain',     quantity: 400, unit: Unit.g,    expiryDate: daysFromNow(548), nutriscore: 'A', storageZoneId: z['pantry_shelf_1'].id,        ownerId: bob.id,     isShared: true  },
    { name: 'Chips paprika',         brand: "Lay's",          quantity: 150, unit: Unit.g,    expiryDate: daysFromNow(60),  nutriscore: 'E', storageZoneId: z['pantry_shelf_1'].id,        ownerId: charlie.id, isShared: false },
  ];

  await prisma.item.createMany({ data: items });
  console.log(`✅ ${items.length} items créés`);

  // ── 4. Liste de courses ────────────────────────────────────────────────────
  const list = await prisma.shoppingList.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000001', name: 'Liste de la semaine' },
  });
  await prisma.shoppingItem.createMany({
    skipDuplicates: true,
    data: [
      { name: 'Lait entier', quantity: 2, unit: Unit.L, status: 'pending', isAutoSuggested: false, shoppingListId: list.id, addedById: alice.id },
      { name: 'Pain de mie',  quantity: 1, unit: Unit.unit, status: 'pending', isAutoSuggested: false, shoppingListId: list.id, addedById: bob.id },
    ],
  });
  console.log('✅ Liste de courses initialisée');


  // ── 5. Dépenses de démonstration (module Finance) ─────────────────────────
  //
  // GRAPHE DE DETTES CONÇU POUR TESTER L'ALGO GREEDY :
  //
  //   Alice paie les courses (87.40€) + resto (96€) + 2e courses (62.15€)
  //     → totalPaid:  245.55€
  //   Charlie paie le loyer (1800€)
  //     → totalPaid: 1800.00€ — mais sa part lui revient (300€) → net +1500€
  //   Bob paie l'électricité (124€)
  //     → totalPaid:  124.00€
  //
  // Balances attendues APPROXIMATIVES après seed :
  //   Charlie  ≈ +1500€  (créditeur majeur : a avancé le loyer)
  //   Alice    ≈ +80€    (a avancé les courses)
  //   Eric     ≈ +20€    (a payé internet)
  //   Bob      ≈ -30€    (débiteur net)
  //   Diana    ≈ -50€    (débiteur net)
  //   Fatima   ≈ -20€    (débiteur net)
  //
  // Résultat attendu de l'algo : 4-5 transactions au lieu de 15 possibles.
  //
  // IDEMPOTENT : deleteMany avant createMany pour re-seeds sans erreurs.

  await prisma.transaction.deleteMany({});
  await prisma.expenseSplit.deleteMany({});
  await prisma.expense.deleteMany({});

  // Helper centimes — évite les flottants dans le seed
  const splitEvenly = (totalCents: number, n: number): number[] => {
    const base = Math.floor(totalCents / n);
    const extra = totalCents % n;
    return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  };

  type SeedExpense = {
    description: string;
    totalCents: number;
    category: 'groceries' | 'utilities' | 'rent' | 'other';
    paidById: string;
    participantIds: string[];
  };

  const allUserIds = [alice.id, bob.id, charlie.id, diana.id, eric.id, fatima.id];

  const seedExpenses: SeedExpense[] = [
    {
      description: 'Courses Carrefour S1',
      totalCents: 8740,           // 87.40€
      category: 'groceries',
      paidById: alice.id,
      participantIds: allUserIds,
    },
    {
      description: 'Facture EDF Novembre',
      totalCents: 12400,          // 124.00€
      category: 'utilities',
      paidById: bob.id,
      participantIds: allUserIds,
    },
    {
      description: 'Restaurant anniversaire Diana',
      totalCents: 9600,           // 96.00€ — 4 personnes seulement
      category: 'other',
      paidById: alice.id,
      participantIds: [alice.id, bob.id, diana.id, eric.id],
    },
    {
      description: 'Fibre SFR Novembre',
      totalCents: 3999,           // 39.99€
      category: 'utilities',
      paidById: eric.id,
      participantIds: allUserIds,
    },
    {
      description: 'Produits ménagers',
      totalCents: 3460,           // 34.60€
      category: 'groceries',
      paidById: fatima.id,
      participantIds: allUserIds,
    },
    {
      description: 'Loyer Novembre',
      totalCents: 180000,         // 1 800.00€ — Charlie avance pour tout le monde
      category: 'rent',
      paidById: charlie.id,
      participantIds: allUserIds,
    },
    {
      description: 'Courses Bio c Bon S2',
      totalCents: 6215,           // 62.15€
      category: 'groceries',
      paidById: alice.id,
      participantIds: allUserIds,
    },
  ];

  for (const def of seedExpenses) {
    const totalEuros = (def.totalCents / 100).toFixed(2);
    const amounts = splitEvenly(def.totalCents, def.participantIds.length);

    const expense = await prisma.expense.create({
      data: {
        description: def.description,
        amount: totalEuros,
        category: def.category,
        paidById: def.paidById,
      },
    });

    await prisma.expenseSplit.createMany({
      data: def.participantIds.map((uid, i) => ({
        expenseId: expense.id,
        userId: uid,
        shareAmount: (amounts[i] / 100).toFixed(2),
        isSettled: false,
      })),
    });
  }

  console.log(`✅ ${seedExpenses.length} dépenses créées — module Finance`);
  console.log('   → GET /api/finance/status pour voir les balances et dettes simplifiées');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 Seed terminé ! États attendus du Digital Twin :');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  fridge_shelf_top      → 🔴 CRITICAL  (soupe périmée + poulet demain)');
  console.log('  fridge_shelf_middle   → 🟡 WARNING   (lait J+5, fromage J+6)');
  console.log('  fridge_shelf_bottom   → 🟢 OK        (tout frais ≥ J+18)');
  console.log('  fridge_door_shelf_1   → 🟢 FULL      (8 boissons, > 8L capacité)');
  console.log('  fridge_crisper_left   → 🟢 LOW       (2 carottes)');
  console.log('  fridge_crisper_right  → ⚪ EMPTY     (aucun item)');
  console.log('  freezer_drawer_1      → 🟢 OK        (3 surgelés)');
  console.log('  cabinet_left_shelf_1  → 🟢 OK        (4 items épicerie)');
  console.log('  cabinet_right_shelf_1 → 🟡 WARNING   (farine expire J+4)');
  console.log('  pantry_shelf_1        → 🟢 MEDIUM    (6 items garde-manger)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n  🔑 Login : alice@colocos.local / password123');
  console.log('  🌐 Test  : GET http://localhost:3001/api/fridge/state\n');
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());