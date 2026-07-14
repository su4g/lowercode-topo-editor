export type ConditionGroup = {
  logic?: "and" | "or";
  conditions: Array<Condition | ConditionGroup>;
};
export type Condition = {
  field: string;
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
