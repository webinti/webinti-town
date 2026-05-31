// Élargissement pur de la data d'une couche tuiles (row-major) : on garde les
// W premières colonnes de chaque ligne, on complète à droite par des 0 jusqu'à newW.
export function widenRow(row, newW) {
  const out = row.slice(0, newW);
  while (out.length < newW) out.push(0);
  return out;
}

export function widenData(data, W, H, newW) {
  const out = [];
  for (let y = 0; y < H; y++) {
    const row = data.slice(y * W, y * W + W);
    out.push(...widenRow(row, newW));
  }
  return out;
}
