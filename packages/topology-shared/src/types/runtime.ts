export type RuntimeVisibility = {
  ruleVisible?: boolean;
  externalVisible?: boolean;
  manualVisible?: boolean;
  finalVisible?: boolean;
};

export type NodeRuntime = {
  visible?: boolean;
  text?: string;
  status?: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  opacity?: number;
  visibility?: RuntimeVisibility;
};

export type LinkRuntime = {
  visible?: boolean;
  state?: string;
  color?: string;
  width?: number;
  animated?: boolean;
  flowDirection?: "fromTo" | "toFrom" | "both";
  visibility?: RuntimeVisibility;
};

export type RuntimeStyle = {
  backgroundColor?: string;
  borderColor?: string;
  opacity?: number;
};

export type RuntimePatch = {
  key: string;
  runtime: Record<string, unknown>;
};
