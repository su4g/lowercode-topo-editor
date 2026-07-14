import type { ContainerStyle, LinkStyle } from "./rule";

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
  backgroundOpacity?: number;
  borderColor?: string;
  transparentBackground?: boolean;
  dashedBorder?: boolean;
  opacity?: number;
  visibility?: RuntimeVisibility;
};

export type LinkRuntime = {
  visible?: boolean;
  state?: string;
  color?: string;
  width?: number;
  opacity?: number;
  lineCap?: LinkStyle["lineCap"];
  animated?: boolean;
  flowDirection?: "fromTo" | "toFrom" | "both";
  dash?: number[];
  flow?: LinkStyle["flow"];
  glow?: LinkStyle["glow"];
  visibility?: RuntimeVisibility;
};

export type RuntimeStyle = {
  backgroundColor?: string;
  backgroundOpacity?: number;
  borderColor?: string;
  transparentBackground?: boolean;
  dashedBorder?: boolean;
  opacity?: number;
} & ContainerStyle;

export type RuntimePatch = {
  key: string;
  runtime: Record<string, unknown>;
};
