export function getByPath(source: unknown, path?: string): unknown {
  if (!path) return source;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}
