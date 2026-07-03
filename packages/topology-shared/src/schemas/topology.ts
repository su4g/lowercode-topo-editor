import { z } from "zod";

export const dataBindingSchema = z.object({
  enabled: z.boolean(),
  sourceId: z.string().optional(),
  mappings: z.record(z.string()).optional(),
  bindings: z.array(z.object({
    target: z.string(),
    template: z.string().optional(),
    path: z.string().optional()
  })).optional()
});

export const dataSourceConfigSchema = z.object({
  url: z.string().optional(),
  method: z.enum(["GET", "POST"]).optional(),
  interval: z.number().optional(),
  topic: z.string().optional(),
  ws: z.object({
    url: z.string().optional(),
    subscribeMessage: z.record(z.unknown()).optional(),
    messageKeyPath: z.string().optional(),
    dataRootPath: z.string().optional(),
    heartbeatInterval: z.number().optional()
  }).optional(),
  data: z.record(z.unknown()).optional(),
  mockData: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  query: z.record(z.string()).optional(),
  body: z.record(z.unknown()).optional(),
  responseMapping: z.object({
    rootPath: z.string().optional()
  }).optional()
});

export const topologyNodeSchema = z.object({
  key: z.string().min(1),
  typeId: z.string().min(1),
  label: z.string().min(1),
  loc: z.string().default("0 0"),
  size: z.string().optional(),
  angle: z.number().optional(),
  zOrder: z.number().optional(),
  group: z.string().optional(),
  isGroup: z.boolean().optional(),
  props: z.record(z.unknown()).optional(),
  dataBinding: dataBindingSchema.optional(),
  runtime: z.record(z.unknown()).optional(),
  displayRules: z.array(z.record(z.unknown())).optional(),
  eventConfig: z.array(z.record(z.unknown())).optional()
});

export const topologyLinkSchema = z.object({
  key: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  fromPort: z.string().optional(),
  toPort: z.string().optional(),
  direction: z.enum(["forward", "reverse", "both"]).optional(),
  showArrow: z.boolean().optional(),
  linkType: z.enum(["power-line", "signal-line", "pipe-line", "logic-line"]).optional(),
  label: z.string().optional(),
  defaultState: z.enum(["off", "running", "warning", "fault", "offline"]).optional(),
  defaultStyle: z.record(z.unknown()).optional(),
  dataBinding: dataBindingSchema.optional(),
  rules: z.array(z.record(z.unknown())).optional(),
  runtime: z.record(z.unknown()).optional(),
  points: z.unknown().optional()
});

export const topologyDataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  nodeTypesVersion: z.string().optional(),
  dataSources: z.array(z.object({
    sourceId: z.string(),
    name: z.string().optional(),
    type: z.enum(["http", "websocket", "mqtt", "static"]).optional(),
    enabled: z.boolean().optional(),
    config: dataSourceConfigSchema.optional(),
    fields: z.array(z.string()).optional()
  })).optional(),
  nodes: z.array(topologyNodeSchema),
  links: z.array(topologyLinkSchema),
  globalRules: z.array(z.record(z.unknown())).optional(),
  viewport: z.object({
    position: z.string().optional(),
    scale: z.number().optional()
  }).optional()
});
