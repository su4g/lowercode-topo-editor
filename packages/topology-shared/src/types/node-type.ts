export type NodeCategory = "equipment" | "container" | "annotation" | "control";

export type NodeStatusKey = "default" | "running" | "fault" | "offline";

export type PortDefinition = {
  id: string;
  label: string;
  direction: "in" | "out" | "both";
  maxLinks?: number;
  linkTypes?: string[];
  voltageLevel?: string;
  signalType?: "power" | "signal" | "network" | "control";
};

export type FormFieldDefinition = {
  field: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "boolean" | "textarea" | "color";
  required?: boolean;
  defaultValue?: unknown;
  unit?: string;
  options?: Array<{ label: string; value: string | number | boolean }>;
};

export type BindableFieldDefinition = {
  field: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum" | "date";
  unit?: string;
  options?: Array<string | number | boolean>;
};

export type ConnectionCapability = {
  linkType: string;
  fromPort?: string;
  toTypes?: string[];
  toPorts?: string[];
};

export type NodeActionDefinition = {
  id: string;
  label: string;
  type: "click" | "doubleClick" | "contextMenu";
};

export type NodeTypeDefinition = {
  id: string;
  name: string;
  category: NodeCategory;
  description?: string;
  icon?: string;
  statusImages?: Partial<Record<NodeStatusKey, string>>;
  template: string;
  defaultSize?: { width: number; height: number };
  isGroup?: boolean;
  canContain?: string[];
  allowNestedGroup?: boolean;
  ports?: PortDefinition[];
  formSchema?: FormFieldDefinition[];
  bindableFields?: BindableFieldDefinition[];
  connectionCapabilities?: ConnectionCapability[];
  actions?: NodeActionDefinition[];
};
