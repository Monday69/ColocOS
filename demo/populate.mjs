// ColocOS — remplit une base de DÉMO via l'API (aucune donnée réelle).
//   node demo/populate.mjs            (backend lancé sur http://localhost:3001)
// Prérequis : `npm run db:seed` (colocs fictifs, mot de passe `coloc2026`).

const API = process.env.COLOCOS_API ?? 'http://localhost:3001/api';
const PASSWORD = 'coloc2026';
const USERS = ['matteo', 'pote1', 'pote2', 'pote3', 'pote4', 'pote5', 'pote6'];

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

async function call(method, path, token, body, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json.data;
}

const sessions = {};
for (const u of USERS) {
  const data = await call('POST', '/auth/login', null, { email: `${u}@colocos.local`, password: PASSWORD });
  sessions[u] = { token: data.tokens.accessToken, id: data.user.id, name: data.user.name };
}
console.log('connectés :', Object.values(sessions).map((s) => s.name).join(', '));
const me = sessions.matteo.token;

const zones = await call('GET', '/fridge/zones', me);
const zoneId = (meshId) => {
  const z = zones.find((x) => x.meshId === meshId);
  if (!z) throw new Error(`zone inconnue : ${meshId}`);
  return z.id;
};

// [nom, marque, qté, unité, péremption (jours), nutriscore, zone, propriétaire|null, kcal, prot, gluc, lip]
const ITEMS = [
  ['Lait demi-écrémé', 'Lactel', 1, 'L', 6, 'B', 'fridge_door_right_1', null, 46, 3.2, 4.8, 1.6],
  ['Œufs plein air', null, 6, 'unit', 12, 'A', 'fridge_door_left_1', null, 143, 12.6, 0.7, 9.9],
  ['Beurre doux', 'Président', 250, 'g', 30, 'E', 'fridge_door_bottom', null, 744, 0.7, 0.6, 82],
  ['Yaourts nature', 'Danone', 4, 'unit', 2, 'A', 'fridge_shelf_mid_top', 'pote1', 60, 4.1, 5, 2.8],
  ['Blancs de poulet', null, 400, 'g', 1, 'A', 'fridge_shelf_low', 'pote2', 110, 23, 0, 1.8],
  ['Comté 18 mois', null, 200, 'g', 20, 'D', 'fridge_shelf_mid_low', null, 414, 27, 0.5, 34],
  ['Jambon blanc', 'Herta', 4, 'unit', 3, 'C', 'fridge_shelf_mid_low', 'matteo', 110, 21, 0.8, 3],
  ['Tomates cerises', null, 250, 'g', 4, 'A', 'fridge_crisper_left', null, 18, 0.9, 3.9, 0.2],
  ['Carottes', null, 1, 'kg', 14, 'A', 'fridge_crisper_right', null, 41, 0.9, 9.6, 0.2],
  ['Courgettes', null, 3, 'unit', -1, 'A', 'fridge_crisper_left', null, 17, 1.2, 3.1, 0.3],
  ['Skyr vanille', 'Siggi’s', 2, 'unit', 9, 'A', 'fridge_shelf_top', 'pote3', 77, 9.5, 8, 0.2],
  ['Jus d’orange', 'Tropicana', 1, 'L', 5, 'C', 'fridge_door_right_2', null, 45, 0.7, 10, 0.1],
  ['Pesto genovese', 'Barilla', 190, 'g', 25, 'D', 'fridge_door_left_2', null, 520, 5, 6, 52],
  ['Petits pois surgelés', 'Picard', 1, 'kg', 180, 'A', 'freezer_drawer_1', null, 72, 5.4, 9, 0.6],
  ['Pizza margherita', 'Buitoni', 1, 'unit', 90, 'C', 'freezer_drawer_2', 'pote4', 238, 9.6, 30, 8],
  ['Pâtes complètes', 'Panzani', 500, 'g', 300, 'A', 'cabinet_left_shelf_1', null, 352, 13, 64, 2.5],
  ['Riz basmati', 'Taureau Ailé', 1, 'kg', 365, 'A', 'cabinet_left_shelf_2', null, 351, 8, 78, 0.6],
  ['Flocons d’avoine', 'Quaker', 500, 'g', 200, 'A', 'pantry_shelf_1', 'pote5', 372, 13.5, 58.7, 7],
  ['Huile d’olive', 'Puget', 1, 'L', 400, 'B', 'pantry_shelf_2', null, 824, 0, 0, 91.6],
  ['Pois chiches', 'Bonduelle', 2, 'unit', 500, 'A', 'cabinet_right_shelf_1', null, 120, 7, 13, 2.6],
];

let n = 0;
for (const [name, brand, quantity, unit, exp, nutriscore, mesh, owner, kcal, p, c, f] of ITEMS) {
  const token = owner ? sessions[owner].token : me;
  await call('POST', '/inventory/items', token, {
    name, brand, quantity, unit, nutriscore,
    expiryDate: day(exp),
    isShared: owner === null,
    storageZoneId: zoneId(mesh),
    ownerId: owner ? sessions[owner].id : null,
    calories: kcal, proteins: p, carbohydrates: c, fat: f,
  });
  n++;
}
console.log(`aliments : ${n}`);

// [payeur, description, montant, catégorie]
const EXPENSES = [
  ['matteo', 'Courses Lidl de la semaine', 86.4, 'groceries'],
  ['pote1', 'Facture électricité novembre', 124.0, 'utilities'],
  ['pote2', 'Internet fibre', 39.99, 'utilities'],
  ['pote3', 'Courses Carrefour', 54.2, 'groceries'],
  ['pote4', 'Produits ménagers', 23.5, 'other'],
  ['matteo', 'Raclette du vendredi', 47.8, 'groceries'],
];
for (const [payer, description, amount, category] of EXPENSES) {
  await call('POST', '/finance/expenses', sessions[payer].token, { description, amount, category });
}
console.log(`dépenses : ${EXPENSES.length}`);

const SHOPPING = [
  ['Bananes', 6, 'unit'], ['Fromage râpé', 200, 'g'], ['Papier toilette', 1, 'unit'],
  ['Lessive', 1, 'unit'], ['Tortillas', 1, 'unit'], ['Avocats', 3, 'unit'],
];
for (const [name, quantity, unit] of SHOPPING) {
  await call('POST', '/shopping/items', me, { name, quantity, unit });
}
console.log(`courses : ${SHOPPING.length}`);

// ── Profil athlète (nutrition) ───────────────────────────────────────────────
// Sans profil, l'écran « Nutrition & Stats » affiche 0 / 0 : on en crée un
// pour que la démo montre des cibles calculées par le serveur (Mifflin-St Jeor).
await call('PUT', '/profile', me, {
  heightCm: 178,
  weightKg: 74,
  birthDate: '1998-04-12',
  sex: 'M',
  activityFactor: 1.725,
  goal: 'BULK',
});
console.log('profil athlète : 178 cm / 74 kg · objectif prise de masse');

// Pesées : la balance n'a pas de JWT, elle s'authentifie avec X-Device-Key
const DEVICE_KEY = process.env.SCALE_DEVICE_KEY ?? 'demo_scale_key';
const WEIGH_INS = [74.6, 74.3, 74.0];
for (const weightKg of WEIGH_INS) {
  await call(
    'POST',
    '/profile/weigh-in',
    null,
    { weightKg, userId: sessions.matteo.id },
    { 'x-device-key': DEVICE_KEY },
  );
}
console.log(`pesées : ${WEIGH_INS.length}`);

// Repas du jour : journal nutritionnel et macros consommées
const MEALS = [
  [
    { name: 'Flocons d’avoine', grams: 80, calories: 298, proteins: 10.8, carbs: 47, fat: 5.6 },
    { name: 'Skyr vanille', grams: 150, calories: 116, proteins: 14.3, carbs: 12, fat: 0.3 },
  ],
  [
    { name: 'Blancs de poulet', grams: 180, calories: 198, proteins: 41.4, carbs: 0, fat: 3.2 },
    { name: 'Riz basmati', grams: 120, calories: 421, proteins: 9.6, carbs: 93.6, fat: 0.7 },
  ],
];
for (const items of MEALS) {
  await call('POST', '/meals', me, { items });
}
console.log(`repas du jour : ${MEALS.length}`);
console.log('\nDémo prête. Connexion : profil « Mattéo » (pas de PIN).');
