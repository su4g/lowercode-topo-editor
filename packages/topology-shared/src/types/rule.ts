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
  animated?: boolean;
  flowDirection?: "fromTo" | "toFrom" | "both";
  dash?: number[];
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
  };
};

export type GlobalTopologyRule = {
  id: string;
  name: string;
  priority: number;
  condition: ConditionGroup;
  action: Record<string, unknown>;
};
