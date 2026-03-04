import type { CollectionSource } from "./types.js";

type SourceLoader = () => Promise<CollectionSource>;

const registry = new Map<string, SourceLoader>();

registry.set("bear", () => import("./bear.js").then(m => m.default));

export function hasSource(type: string): boolean {
  return registry.has(type);
}

export async function getSource(type: string): Promise<CollectionSource> {
  const loader = registry.get(type);
  if (!loader) {
    throw new Error(`Unknown collection source: "${type}". Available: ${[...registry.keys()].join(", ")}`);
  }
  return loader();
}
