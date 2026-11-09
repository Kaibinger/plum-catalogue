/*
  Layer pattern for cartons on a pallet.
  packLayer(lMm, wMm, n, palletL = 1200, palletW = 800)
    -> [{ x, y, l, w }, …] (n placements, mm from the pallet corner,
       l/w = footprint as placed) or null when no simple pattern fits n.
  Tries a plain grid in each orientation, then two blocks (one per
  orientation) split along the pallet length or width.
  The result is illustrative: the real stacking pattern is not in the data.
*/
function grid(x0, y0, areaL, areaW, l, w) {
  const out = [];
  const cols = Math.floor(areaL / l + 1e-9), rows = Math.floor(areaW / w + 1e-9);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x0 + c * l, y: y0 + r * w, l, w });
  return out;
}

export function packLayer(lMm, wMm, n, palletL = 1200, palletW = 800) {
  if (!(lMm > 0 && wMm > 0 && n > 0)) return null;
  const o1 = [lMm, wMm], o2 = [wMm, lMm];
  const candidates = [() => grid(0, 0, palletL, palletW, ...o1), () => grid(0, 0, palletL, palletW, ...o2)];
  for (const [a, b] of [[o1, o2], [o2, o1]]) {
    // split along the length: first block uses orientation a
    for (let k = 1; k * a[0] < palletL; k++) {
      const cut = k * a[0];
      candidates.push(() => [...grid(0, 0, cut, palletW, ...a), ...grid(cut, 0, palletL - cut, palletW, ...b)]);
    }
    // split along the width
    for (let k = 1; k * a[1] < palletW; k++) {
      const cut = k * a[1];
      candidates.push(() => [...grid(0, 0, palletL, cut, ...a), ...grid(0, cut, palletL, palletW - cut, ...b)]);
    }
  }
  for (const make of candidates) {
    const placed = make();
    if (placed.length >= n) return placed.slice(0, n);
  }
  return null;
}
