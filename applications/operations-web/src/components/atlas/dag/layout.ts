/**
 * Layered (Sugiyama-style, simplified) left-to-right auto-layout for small DAGs.
 *  1. layer = longest path from a source (deps-only input, cycles are ignored defensively)
 *  2. order inside a layer by the barycenter of the dependencies' rows (two sweeps)
 *  3. every layer is centred vertically; node sizes may differ (expanded groups are larger)
 * Pure and deterministic: the same nodes give the same coordinates (stable across live updates).
 */
export interface LayoutInput {
  id: string;
  deps: string[];
  w: number;
  h: number;
}
export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  row: number;
}
export interface LayoutResult {
  boxes: Record<string, LayoutBox>;
  width: number;
  height: number;
  layers: string[][];
}

export function layeredLayout(nodes: LayoutInput[], opts: { colGap?: number; rowGap?: number } = {}): LayoutResult {
  const colGap = opts.colGap ?? 64;
  const rowGap = opts.rowGap ?? 22;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = layerOf.get(id);
    if (known != null) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = byId.get(id);
    const deps = (n?.deps ?? []).filter((d) => byId.has(d));
    const l = deps.length ? Math.max(...deps.map(depth)) + 1 : 0;
    visiting.delete(id);
    layerOf.set(id, l);
    return l;
  };
  nodes.forEach((n) => depth(n.id));
  const nLayers = nodes.length ? Math.max(...nodes.map((n) => layerOf.get(n.id) ?? 0)) + 1 : 0;
  const layers: string[][] = Array.from({ length: nLayers }, () => []);
  nodes.forEach((n) => layers[layerOf.get(n.id) ?? 0].push(n.id)); // input (topological) order first

  // barycenter ordering: forward sweep by deps, backward sweep by dependants
  const rowOf = new Map<string, number>();
  const setRows = () => layers.forEach((L) => L.forEach((id, i) => rowOf.set(id, i)));
  setRows();
  const dependants = new Map<string, string[]>();
  nodes.forEach((n) => n.deps.forEach((d) => (dependants.get(d) ?? dependants.set(d, []).get(d)!).push(n.id)));
  const bary = (ids: string[]) => (ids.length ? ids.reduce((s, d) => s + (rowOf.get(d) ?? 0), 0) / ids.length : null);
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < nLayers; l++) {
      const L = layers[l];
      const score = new Map(L.map((id, i) => [id, bary((byId.get(id)?.deps ?? []).filter((d) => byId.has(d))) ?? i]));
      L.sort((a, b) => score.get(a)! - score.get(b)! || L.indexOf(a) - L.indexOf(b));
      setRows();
    }
    for (let l = nLayers - 2; l >= 0; l--) {
      const L = layers[l];
      const score = new Map(L.map((id, i) => [id, bary(dependants.get(id) ?? []) ?? i]));
      L.sort((a, b) => score.get(a)! - score.get(b)! || L.indexOf(a) - L.indexOf(b));
      setRows();
    }
  }

  const colW = layers.map((L) => Math.max(0, ...L.map((id) => byId.get(id)!.w)));
  const colH = layers.map((L) => L.reduce((s, id) => s + byId.get(id)!.h, 0) + Math.max(0, L.length - 1) * rowGap);
  const height = Math.max(0, ...colH);
  const boxes: Record<string, LayoutBox> = {};
  let x = 0;
  layers.forEach((L, li) => {
    let y = (height - colH[li]) / 2;
    L.forEach((id, row) => {
      const n = byId.get(id)!;
      boxes[id] = { x: x + (colW[li] - n.w) / 2, y, w: n.w, h: n.h, layer: li, row };
      y += n.h + rowGap;
    });
    x += colW[li] + colGap;
  });
  const width = Math.max(0, x - colGap);
  return { boxes, width, height, layers };
}

/** Smooth left→right connector between two boxes (right-middle → left-middle). */
export function edgePath(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, inset = 6): string {
  const ax = a.x + a.w;
  const ay = a.y + a.h / 2;
  const bx = b.x - inset;
  const by = b.y + b.h / 2;
  const dx = Math.max(24, (bx - ax) * 0.5);
  return `M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`;
}
