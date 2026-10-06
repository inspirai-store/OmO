import fs from "node:fs/promises";
const heap = JSON.parse(await fs.readFile(".data/viewer.heapsnapshot", "utf8")),
  fields = heap.snapshot.meta.node_fields,
  ef = heap.snapshot.meta.edge_fields,
  N = fields.length,
  E = ef.length,
  nodes = heap.nodes,
  edges = heap.edges,
  strings = heap.strings;
const ni = Object.fromEntries(fields.map((f, i) => [f, i])),
  ei = Object.fromEntries(ef.map((f, i) => [f, i])),
  types = heap.snapshot.meta.edge_types[0];
const flags = new Map(),
  names = new Map(),
  targets = [];
let edge = 0;
for (let n = 0; n < nodes.length; n += N) {
  const name = strings[nodes[n + ni.name]],
    count = nodes[n + ni.edge_count];
  if (/WebGL|ImageBitmap|ResizeObserver|Detached/.test(name))
    names.set(name, (names.get(name) ?? 0) + 1);
  for (let i = 0; i < count; i++) {
    const p = edge + i * E,
      key = strings[edges[p + ei.name_or_index]];
    if (
      [
        "isMesh",
        "isMaterial",
        "isTexture",
        "isBufferGeometry",
        "isWebGLRenderer",
      ].includes(key) &&
      types[edges[p + ei.type]] === "property"
    ) {
      flags.set(key, (flags.get(key) ?? 0) + 1);
      if (key === "isWebGLRenderer") targets.push(n);
    }
  }
  edge += count * E;
}
console.log("FLAGS", Object.fromEntries(flags));
console.log(
  "NAMES",
  Object.fromEntries(
    [...names]
      .filter(([name, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30),
  ),
);
const native = [];
for (let n = 0; n < nodes.length; n += N)
  if (strings[nodes[n + ni.name]] === "WebGL2RenderingContext") native.push(n);
const target = targets[2] ?? native[10];
if (target !== undefined) {
  let cursor = 0;
  const reverse = new Map();
  for (let n = 0; n < nodes.length; n += N) {
    const count = nodes[n + ni.edge_count];
    for (let i = 0; i < count; i++) {
      const p = cursor + i * E;
      if (types[edges[p + ei.type]] === "weak") continue;
      const to = edges[p + ei.to_node],
        list = reverse.get(to) ?? [];
      list.push({
        nodeIndex: n,
        name: strings[nodes[n + ni.name]],
        type: types[edges[p + ei.type]],
        key: strings[edges[p + ei.name_or_index]],
      });
      reverse.set(to, list);
    }
    cursor += count * E;
  }
  const queue = [{ node: target, path: [] }],
    seen = new Set();
  let i = 0;
  while (i < queue.length && i < 100000) {
    const current = queue[i++];
    if (seen.has(current.node)) continue;
    seen.add(current.node);
    if (
      current.node === 0 ||
      strings[nodes[current.node + ni.name]] === "(GC roots)"
    ) {
      console.log("ROOT PATH", current.path);
      break;
    }
    if (current.path.length > 40) continue;
    for (const entry of reverse.get(current.node) ?? [])
      queue.push({ node: entry.nodeIndex, path: [...current.path, entry] });
  }
}
