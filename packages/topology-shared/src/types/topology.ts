import type { DataBindingConfig, DataSourceReference } from "./data-source";
import type { DisplayRule, GlobalTopologyRule, LinkRuntimeRule, LinkStyle } from "./rule";
import type { LinkRuntime, NodeRuntime } from "./runtime";

export type NodeEventConfig = {
  id?: string;
  enabled?: boolean;
  trigger: "click" | "doubleClick" | "contextMenu";
  eventName: string;
  eventKey: string;
  eventData?: Record<string, unknown>;
  eventDataTemplate?: Record<string, unknown>;
  bindNodeKey?: string;
  /** Supports rule-style expression paths. Local props/runtime paths resolve against the bound node. */
  bindDataPath?: string;
  preventDefault?: boolean;
};

export type NodeLabelPosition = "top" | "right" | "bottom" | "left";

export type NodeLabelOffset = { x: number; y: number };

export type NodeLabelStyle = {
  color?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  textDecoration?: string;
  textAlign?: "left" | "center" | "right";
};

export const DEFAULT_TOPOLOGY_CANVAS = {
  width: 1920,
  height: 1080
};

export const DEFAULT_TOPOLOGY_TEXT_COLOR = "#fff";

export type TopologyCanvasConfig = {
  width: number;
  height: number;
};

export type TopologyNode = {
  key: string;
  typeId: string;
  label: string;
  labelPosition?: NodeLabelPosition;
  labelOffset?: NodeLabelOffset;
  labelStyle?: NodeLabelStyle;
  loc: string;
  size?: string;
  angle?: number;
  zOrder?: number;
  group?: string;
  isGroup?: boolean;
  props?: Record<string, unknown>;
  dataBinding?: DataBindingConfig;
  runtime?: NodeRuntime;
  displayRules?: DisplayRule[];
  eventConfig?: NodeEventConfig[];
};

export type TopologyLink = {
  key: string;
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
  direction?: "forward" | "reverse" | "both";
  showArrow?: boolean;
  linkType?: "power-line" | "signal-line" | "pipe-line" | "logic-line";
  label?: string;
  defaultState?: "off" | "running" | "warning" | "fault" | "offline";
  defaultStyle?: LinkStyle;
  dataBinding?: DataBindingConfig;
  rules?: LinkRuntimeRule[];
  runtime?: LinkRuntime;
  points?: unknown;
};

export type TopologyData = {
  /** Undefined and 1 represent legacy string-expression rule data. */
  schemaVersion?: number;
  id: string;
  name: string;
  version: string;
  nodeTypesVersion?: string;
  dataSources?: DataSourceReference[];
  nodes: TopologyNode[];
  links: TopologyLink[];
  globalRules?: GlobalTopologyRule[];
  canvas?: TopologyCanvasConfig;
  viewport?: {
    position?: string;
    scale?: number;
  };
};
