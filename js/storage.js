const STORE = 'locations';

localforage.config({
  name: 'Reseloggen',
  storeName: STORE,
  description: 'Platser för resan'
});

export async function getAll() {
  return (await localforage.getItem(STORE)) || [];
}

export async function setAll(items) {
  return localforage.setItem(STORE, items);
}

export async function add(item) {
  const all = await getAll();
  all.unshift(item);
  await setAll(all);
  return item;
}

export async function update(id, changes) {
  const all = await getAll();
  const idx = all.findIndex(l => l.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...changes };
  await setAll(all);
  return all[idx];
}

export async function remove(id) {
  const all = await getAll();
  await setAll(all.filter(l => l.id !== id));
}

export async function findById(id) {
  return (await getAll()).find(l => l.id === id) || null;
}

// Hjälpare: unika datum med antal
export function uniqueDates(logs) {
  const m = new Map();
  for (const l of logs) m.set(l.dateString, (m.get(l.dateString) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}