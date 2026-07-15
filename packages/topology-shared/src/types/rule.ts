export type RuleFieldReferenceKind = "nodeField" | "virtualPoint" | "metadata" | "raw";

/** Stable rule reference. User-editable names are snapshots; runtime lookup uses stable keys. */
export type RuleFieldReference = {
  kind: RuleFieldReferenceKind;
  nodeKey?: string;
  sourceRefId?: string;
  dataPath?: string;
  deviceId?: number;
  pointId?: number;
  field: string;
  snapshots?: {
    nodeLabel?: string;
    sourceName?: string;
    deviceName?: string;
    pointName?: string;
  };
  legacyExpression?: string;
  migrationIssue?: "ambiguous" | "unresolved";
};

export type ConditionGroup = {
  logic?: "and" | "or";
  conditions: Array<Condition | ConditionGroup>;
};
export type Condition = {
  id?: string;
  field: string;
  /** Structured V2 reference; field remains as a backward-compatible snapshot. */
  ref?: RuleFieldReference;
  legacyField?: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "notIn" | "exists" | "empty";
  value?: unknown;
};

export type LinkStyle = {
  color?: string;
  width?: number;
  opacity?: number;
  lineCap?: "butt" | "round" | "square";
  animated?: boolean;
  flowDirection?: "fromTo" | "toFrom" | "both";
  dash?: number[];
  flow?: {
    color?: string;
    width?: number;
    opacity?: number;
    dash?: number[];
    speed?: number;
  };
  glow?: {
    enabled?: boolean;
    color?: string;
    width?: number;
    opacity?: number;
  };
};

export type LinkRuntimeRule = {
  id: string;
  name: string;
  priority: number;
  trigger: {
    type: "dataChange" | "nodeStateChange" | "manual" | "timer";
    sources?: string[];
    sourceRefs?: RuleFieldReference[];
  };
  condition: ConditionGroup;
  action: {
    state?: "off" | "running" | "warning" | "fault" | "offline";
    style?: LinkStyle;
  };
};

export type ContainerStyle = {
  backgroundColor?: string;
  backgroundOpacity?: number;
  borderColor?: string;
  transparentBackground?: boolean;
  dashedBorder?: boolean;
};

export type DisplayRule = {
  id: string;
  name: string;
  priority: number;
  condition: ConditionGroup;
  action: {
    visible?: boolean;
    status?: "normal" | "warning" | "fault" | "offline" | "unknown" | string;
    color?: string;
    text?: string;
    backgroundColor?: string;
    borderColor?: string;
    opacity?: number;
    style?: ContainerStyle;
  };
};

export type GlobalTopologyRule = {
  id: string;
  name: string;
  priority: number;
  condition: ConditionGroup;
  action: Record<string, unknown>;
};
