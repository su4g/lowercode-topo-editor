# 05-运行态与外部控制

## 目标

让拓扑从“可编辑配置”进入“可运行展示”，支持实时数据刷新、外部业务控制和事件回传。

## 运行态刷新流程

```txt
运行态页面
  -> 查询拓扑配置
  -> 收集 sourceIds 和 fields
  -> 调用运行态聚合接口
  -> 更新 RuntimeDataPool
  -> BindingEngine 计算节点文本和状态
  -> RuleEngine 计算连线、分组、节点 runtime
  -> 批量 commit 到 GoJS model
  -> Diagram 自动刷新
```

## 数据刷新策略

运行态数据源支持 HTTP、WebSocket、static/mock 三类落地方式：

| 类型 | 真实运行态 | 预览运行态 |
|---|---|
| `http` | 按 `config.interval` 轮询请求 URL | 读取 `config.mockData` |
| `websocket` | 建立 WS 连接，按消息合并数据 | 读取 `config.mockData` |
| `static` | 读取静态配置数据 | 读取 `config.mockData` 或 `config.data` |

HTTP 轮询间隔从当前拓扑所有启用 HTTP 数据源中取最小正数，默认 3000ms。WebSocket 不参与 HTTP 轮询。

接口请求和 WS 订阅消息支持模板表达式：

```txt
${params.instanceId}
{tenant.id}
${apiPatams.instanceId}
```

表达式中的第一段名称不固定，由父组件传入的数据决定。运行态只按路径读取，不预设 `params`、`apiPatams` 或其他业务字段。

业务组件进入运行态页面时传入 `templateId` 和 `metaData`：

```ts
type TopologyRuntimeEntry = {
  templateId: string;
  metaData?: Record<string, unknown>;
};
```

运行态会先加载 `templateId` 对应拓扑模板，再用模板中的 `dataSources` 请求数据。

前端要求：

- 相同值不重复更新 GoJS model。
- 一次刷新只做一次批量 commit。
- 只更新 `runtime` 字段，不重建整个 model。
- 编辑态默认不启用高频动画。

## RuntimeDataPool

职责：

- 保存聚合接口返回的实时数据。
- 支持按 `sourceId.path` 读取值。
- 标记数据质量和时间戳。
- 判断字段是否变化。

建议接口：

```ts
type RuntimeDataPool = {
  update(payload: Record<string, unknown>): RuntimeChangeSet;
  get(sourceId: string, path?: string): unknown;
  getByField(field: string): unknown;
  snapshot(): Record<string, unknown>;
};
```

## TopologyCanvasApi

对外暴露受控 API：

```ts
export type TopologyCanvasApi = {
  setGroupVisible(groupKey: string, visible: boolean, options?: VisibilityOptions): void;
  setGroupsVisible(groupKeys: string[], visible: boolean, options?: VisibilityOptions): void;
  toggleGroup(groupKey: string): void;
  setNodeVisible(nodeKey: string, visible: boolean): void;
  setNodeRuntime(nodeKey: string, runtime: Record<string, unknown>): void;
  setLinkRuntime(linkKey: string, runtime: Record<string, unknown>): void;
  focusNode(nodeKey: string): void;
  focusGroup(groupKey: string): void;
  selectNode(nodeKey: string): void;
  applyExternalEvent(event: TopologyExternalEvent): void;
  refreshRuntimeData(): Promise<void>;
};
```

限制：

- 不暴露 GoJS 原始 `Diagram`、`Node`、`Link`。
- 外部控制也必须走 `model.setDataProperty`。
- 需要记录关键外部控制日志。

## 外部事件模型

```ts
export type TopologyExternalEvent =
  | { type: "SET_GROUP_VISIBLE"; target: string; visible: boolean; cascade?: boolean; reason?: string }
  | { type: "SET_GROUP_STYLE"; target: string; style: RuntimeStyle; reason?: string }
  | { type: "FOCUS_NODE"; target: string }
  | { type: "FOCUS_GROUP"; target: string; expand?: boolean }
  | { type: "SET_NODE_RUNTIME"; target: string; runtime: Record<string, unknown> }
  | { type: "SET_LINK_RUNTIME"; target: string; runtime: Record<string, unknown> };
```

## 可见性优先级

统一使用：

```ts
export type RuntimeVisibility = {
  ruleVisible?: boolean;
  externalVisible?: boolean;
  manualVisible?: boolean;
  finalVisible?: boolean;
};
```

计算规则：

```txt
finalVisible = ruleVisible !== false
  && externalVisible !== false
  && manualVisible !== false
```

验收：

- 规则隐藏、外部隐藏、手动隐藏任一为 false，最终隐藏。
- 三层都允许时才显示。
- 编辑态和运行态可以使用不同展示策略。

## 事件回传

对外事件：

```ts
export type TopologyEvent =
  | { type: "NODE_CLICK"; mode: "edit" | "runtime"; nodeKey: string; nodeType: string; nodeData: TopologyNode }
  | { type: "NODE_DOUBLE_CLICK"; mode: "edit" | "runtime"; nodeKey: string; nodeType: string; nodeData: TopologyNode }
  | { type: "NODE_CONTEXT_MENU"; mode: "edit" | "runtime"; nodeKey: string; nodeType: string; nodeData: TopologyNode; position: { x: number; y: number } }
  | { type: "LINK_CLICK"; mode: "edit" | "runtime"; linkKey: string; linkData: TopologyLink }
  | { type: "GROUP_CLICK"; mode: "edit" | "runtime"; groupKey: string; groupData: TopologyNode };
```

验收：

- 点击节点可打开业务详情。
- 点击连线可打开连线详情。
- 点击分组可打开区域详情。
- 事件对象不包含 GoJS 原始实例。

## 性能要求

- 500 节点以内，运行态刷新不明显卡顿。
- 流线动画数量可配置上限。
- 视口外动画可暂停。
- 属性详情懒加载。
