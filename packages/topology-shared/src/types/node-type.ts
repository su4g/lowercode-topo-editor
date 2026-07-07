export type NodeCategory = "equipment" | "container" | "annotation" | "control";

export type NodeStatusKey = "default" | "running" | "fault" | "offline";

export type PortDefinition = {
  id: string;
  label: string;
  direction: "in" | "out" | "both";
  maxLinks?: number;
  linkTypes?: string[];
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

export type GroupStyleDefaults = {
  backgroundColor?: string;
  borderColor?: string;
  backgroundOpacity?: number;
  transparentBackground?: boolean;
  dashedBorder?: boolean;
};

export type AnnotationDefaults = {
  textColor?: string;
  textSize?: number;
};

export type ButtonRenderMode = "text" | "image" | "imageText";

export type ButtonDefaults = {
  buttonText?: string;
  buttonRenderMode?: ButtonRenderMode;
  icon?: string;
  buttonDefaultVisible?: boolean;
};

export type ButtonStyleDefaults = {
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  textSize?: number;
  borderWidth?: number;
  borderRadius?: number;
  paddingX?: number;
  paddingY?: number;
};

export type NodeTypeDefinition = {
  [key: string]: unknown;
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
  groupStyleDefaults?: GroupStyleDefaults;
  annotationDefaults?: AnnotationDefaults;
  buttonDefaults?: ButtonDefaults;
  buttonStyleDefaults?: ButtonStyleDefaults;
};
