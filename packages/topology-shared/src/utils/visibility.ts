import type { RuntimeVisibility } from "../types/runtime";

export function resolveVisibility(visibility?: RuntimeVisibility): RuntimeVisibility {
  const next = visibility ?? {};
  return {
    ...next,
    finalVisible: next.ruleVisible !== false && next.externalVisible !== false && next.manualVisible !== false
  };
}
