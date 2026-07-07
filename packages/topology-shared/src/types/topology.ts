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

export type TopologyNode = {
  key: string;
  typeId: string;
  label: string;
  labelPosition?: NodeLabelPosition;
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
  id: string;
  name: string;
  version: string;
  nodeTypesVersion?: string;
  dataSources?: DataSourceReference[];
  nodes: TopologyNode[];
  links: TopologyLink[];
  globalRules?: GlobalTopologyRule[];
  viewport?: {
    position?: string;
    scale?: number;
  };
};
