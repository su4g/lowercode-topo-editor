export type DataSourceType = "http" | "websocket" | "mqtt" | "static";

export type DataSourceConfig = {
  url?: string;
  method?: "GET" | "POST";
  interval?: number;
  topic?: string;
  ws?: {
    url?: string;
    subscribeMessage?: Record<string, unknown>;
    messageKeyPath?: string;
    dataRootPath?: string;
    heartbeatInterval?: number;
  };
  data?: Record<string, unknown>;
  mockData?: Record<string, unknown>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  responseMapping?: {
    rootPath?: string;
  };
};

export type DataSource = {
  id: string;
  name: string;
  type: DataSourceType;
  enabled?: boolean;
  config: DataSourceConfig;
};

export type DataSourceReference = {
  sourceId: string;
  name?: string;
  type?: DataSourceType;
  enabled?: boolean;
  config?: DataSourceConfig;
  fields?: string[];
};

export type DataBindingConfig = {
  enabled: boolean;
  sourceId?: string;
  mappings?: Record<string, string>;
  bindings?: BindingExpression[];
};

export type BindingExpression = {
  target: string;
  template?: string;
  path?: string;
};
