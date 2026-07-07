# 01-领域模型与数据契约

## 目标

统一前后端对拓扑平台的核心概念，避免编辑器、接口、数据库、规则引擎各自定义一套字段。

## 核心概念

| 概念 | 说明 |
|---|---|
| `NodeTypeDefinition` | 节点类型定义，描述一种元件能力 |
| `TopologyNode` | 某张拓扑图上的节点实例 |
| `TopologyLink` | 某张拓扑图上的连线实例 |
| `DataSource` | HTTP、WebSocket、MQTT、静态数据等数据源 |
| `DataBindingConfig` | 节点、文本、连线、分组的数据映射关系 |
| `ConditionGroup` | 结构化规则条件 |
| `Runtime` | 规则引擎计算后给 GoJS 渲染的运行态 |

## 共享类型目录

```txt
packages/topology-shared/src/
  types/
    node-type.ts
    topology.ts
    data-source.ts
    rule.ts
    runtime.ts
    event.ts
  schemas/
    node-type.schema.ts
    topology.schema.ts
    rule.schema.ts
  utils/
    path.ts
    template.ts
    visibility.ts
```

## 节点类型定义

```ts
export type NodeTypeDefinition = {
  id: string;
  name: string;
  category: "equipment" | "container" | "annotation" | "control";
  description?: string;
  icon?: string;
  template: string;
  defaultSize?: { width: number; height: number };
  isGroup?: boolean;
  canContain?: string[];
  allowNestedGroup?: boolean;
  ports?: PortDefinition[];
  formSchema?: FormFieldDefinition[];
};
```

落地要求：

- `id` 发布后不随意修改。
- `template` 只选择白名单模板，例如 `basicEquipmentTemplate`、`containerGroupTemplate`。
- 动态能力放进 `config_json`，但返回给前端时展开为完整对象。

## 端口定义

```ts
export type PortDefinition = {
  id: string;
  label: string;
  direction: "in" | "out" | "both";
  maxLinks?: number;
  linkTypes?: string[];
};
```

验收点：

- 端口 ID 在同一个节点类型内唯一。
- 连线校验必须检查端口方向和最大连接数。
- 第一版只支持节点上预定义端口，不支持用户自由新增端口。

## 动态表单字段

```ts
export type FormFieldDefinition = {
  field: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "boolean" | "textarea" | "color";
  required?: boolean;
  defaultValue?: unknown;
  unit?: string;
  options?: Array<{ label: string; value: string | number | boolean }>;
};
```

落地要求：

- 字段名使用 camelCase。
- `select` 必须提供 `options`。
- 后端保存前校验必填字段。

## 拓扑节点实例

```ts
export type TopologyNode = {
  key: string;
  typeId: string;
  label: string;
  loc: string;
  group?: string;
  isGroup?: boolean;
  props?: Record<string, unknown>;
  dataBinding?: DataBindingConfig;
  runtime?: NodeRuntime;
  displayRules?: DisplayRule[];
  eventConfig?: NodeEventConfig[];
};
```

落地要求：

- `key` 在一张拓扑内唯一。
- `loc` 使用 GoJS 字符串坐标，例如 `"180 160"`。
- 分组也是节点，使用 `isGroup: true`。
- 业务属性统一放在 `props`。

## 拓扑连线实例

```ts
export type TopologyLink = {
  key: string;
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
  linkType?: "power-line" | "signal-line" | "pipe-line" | "logic-line";
  label?: string;
  defaultState?: "off" | "running" | "warning" | "fault" | "offline";
  defaultStyle?: LinkStyle;
  dataBinding?: DataBindingConfig;
  rules?: LinkRuntimeRule[];
  runtime?: LinkRuntime;
  points?: unknown;
};
```

落地要求：

- 必须配置 `linkKeyProperty: "key"`。
- 端口级连线必须配置 `linkFromPortIdProperty` 和 `linkToPortIdProperty`。
- 允许保存 `points`，但保存前要保证可 JSON 序列化。

## 拓扑整体结构

```ts
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
```

## 数据绑定配置

```ts
export type DataBindingConfig = {
  enabled: boolean;
  sourceId?: string;
  mappings?: Record<string, string>;
  bindings?: BindingExpression[];
};
```

示例：

```json
{
  "enabled": true,
  "sourceId": "device_1001",
  "mappings": {
    "U": "voltage",
    "I": "current",
    "state": "breakerState"
  }
}
```

## 规则条件

```ts
export type ConditionGroup = {
  logic?: "and" | "or";
  conditions: Array<Condition | ConditionGroup>;
};

export type Condition = {
  field: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "notIn" | "exists" | "empty";
  value?: unknown;
};
```

第一版限制：

- 不允许写 JS 表达式。
- `field` 必须来自节点绑定字段、运行态字段或系统白名单字段。
- 操作符按字段类型过滤。

## 命名规范

| 类型 | 示例 |
|---|---|
| 节点 | `breaker_001`、`transformer_001` |
| 分组 | `lab_001`、`area_001` |
| 连线 | `link_001` |
| 数据源 | `device_1001`、`source_lab_001` |
| 规则 | `rule_voltage_fault` |

## 本阶段验收

- 共享类型可以被前后端引用。
- 示例拓扑能通过 schema 校验。
- 字段命名、状态值、key 规则有统一文档。
- 后续接口和页面不再重复定义核心类型。
