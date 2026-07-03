# 06-规则引擎与数据绑定

## 目标

建立统一的数据绑定和规则计算层，让文本、节点、连线、分组都通过同一套运行态数据驱动。

## 数据绑定原则

统一抽象：

```txt
sourceId + mappings + template/rules => runtime
```

不要把设备类型和数据绑定混为一谈：

```txt
typeId: 它是什么
dataBinding: 它是否绑定数据，绑定哪些数据
```

## BindingEngine

职责：

- 根据 `dataBinding.sourceId` 读取运行态数据。
- 根据 `mappings` 生成节点局部变量。
- 渲染文本模板。
- 生成节点 runtime patch。

运行态统一使用表达式上下文解耦模板和业务数据：

```ts
type ExpressionContext = {
  metaData: Record<string, unknown>;
  runtimeData: Record<string, unknown>;
  [sourceId: string]: unknown;
  [nodeKey: string]: unknown;
};
```

上下文路径约定：

| 路径 | 含义 |
|---|---|
| `params.instanceId` | 父组件传入的业务参数，字段名不固定 |
| `api1.data.qf1.status` | HTTP 接口 `api1` 返回数据中的字段 |
| `${api1.data.qf1.status}` | 和上一条等价，规则配置会归一化为路径读取 |
| `ws.qf1.data.status` | WS 数据源 `ws` 中 key 为 `qf1` 的消息数据 |
| `breaker_001.status` | 节点绑定后的别名字段 |
| `runtimeData.api1.data.qf1.status` | 原始运行态数据池字段 |

模板只支持变量替换：

```txt
电压：${U} V
电流：${I} A
状态：${state}
设备：${api1.data.qf1.status}
```

不支持：

- 任意 JS 表达式。
- 函数调用。
- 跨域脚本。

验收：

- 缺失变量显示 `--`。
- 模板变量必须能在发布前校验。
- 文本节点能根据数据刷新。

## RuleEngine

职责：

- 计算连线运行规则。
- 计算分组显示规则。
- 计算节点显示和状态规则。
- 合并规则优先级。
- 输出 runtime patch，不直接操作 GoJS。

建议接口：

```ts
type RuleEngine = {
  evaluate(input: RuleEngineInput): RuleEngineResult;
};

type RuleEngineResult = {
  nodePatches: RuntimePatch[];
  linkPatches: RuntimePatch[];
  groupPatches: RuntimePatch[];
  debug?: RuleDebugRecord[];
};
```

## 连线运行规则

结构：

```ts
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
```

示例：

```json
{
  "id": "running_when_closed",
  "name": "断路器闭合时线路运行",
  "priority": 10,
  "trigger": {
    "type": "dataChange",
    "sources": ["breaker_001.state"]
  },
  "condition": {
    "logic": "and",
    "conditions": [
      { "field": "breaker_001.state", "operator": "eq", "value": "closed" }
    ]
  },
  "action": {
    "state": "running",
    "style": {
      "color": "#22c55e",
      "width": 3,
      "animated": true,
      "flowDirection": "fromTo"
    }
  }
}
```

也可以直接绑定接口表达式，不依赖节点字段别名。字段可写 `api1.data.qf1.status` 或 `${api1.data.qf1.status}`。HTTP 示例：

```json
{
  "id": "running_by_api_expression",
  "name": "接口状态闭合时线路运行",
  "priority": 10,
  "trigger": {
    "type": "dataChange",
    "sources": ["api1.data.qf1.status"]
  },
  "condition": {
    "logic": "and",
    "conditions": [
      { "field": "api1.data.qf1.status", "operator": "eq", "value": "closed" }
    ]
  },
  "action": {
    "state": "running",
    "style": {
      "color": "#22c55e",
      "width": 3,
      "animated": true,
      "flowDirection": "fromTo"
    }
  }
}
```

WebSocket 示例：

```json
{
  "id": "running_by_ws_expression",
  "name": "WS 状态闭合时线路运行",
  "priority": 10,
  "trigger": {
    "type": "dataChange",
    "sources": ["ws.qf1.data.status"]
  },
  "condition": {
    "logic": "and",
    "conditions": [
      { "field": "ws.qf1.data.status", "operator": "eq", "value": "closed" }
    ]
  },
  "action": {
    "state": "running",
    "style": {
      "color": "#22c55e",
      "width": 3,
      "animated": true,
      "flowDirection": "fromTo"
    }
  }
}
```

节点状态规则同样使用表达式：

```json
{
  "id": "node_fault_by_status",
  "name": "设备故障",
  "priority": 20,
  "condition": {
    "logic": "and",
    "conditions": [
      { "field": "api1.data.deviceB.status", "operator": "eq", "value": "fault" }
    ]
  },
  "action": {
    "status": "fault",
    "color": "#ef4444",
    "text": "故障"
  }
}
```

## 分组显示规则

规则动作：

```ts
type DisplayRuleAction = {
  visible?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  opacity?: number;
};
```

隐藏分组时同步处理：

- 分组自身。
- 子节点。
- 子分组。
- 组内连线。
- 与组内节点关联的跨组连线。

编辑态策略：

```txt
半透明展示，并提示运行态隐藏
```

运行态策略：

```txt
真正隐藏
```

## 规则优先级

匹配顺序：

1. `priority` 高的规则优先。
2. 同优先级按状态优先级。
3. 仍冲突时按配置顺序。

状态优先级：

```txt
fault > offline > warning > running > off
```

## 规则编辑器

条件编辑器采用三段式：

```txt
[数据对象] [字段] [操作符] [值]
```

内部保存：

```json
{
  "field": "breaker_001.state",
  "operator": "eq",
  "value": "closed"
}
```

操作符：

| 操作符 | 文案 | 类型 |
|---|---|---|
| `eq` | 等于 | 全部 |
| `ne` | 不等于 | 全部 |
| `gt` | 大于 | number/date |
| `gte` | 大于等于 | number/date |
| `lt` | 小于 | number/date |
| `lte` | 小于等于 | number/date |
| `in` | 包含于 | enum/string/array |
| `notIn` | 不包含于 | enum/string/array |
| `exists` | 有值 | 全部 |
| `empty` | 为空 | 全部 |

## 规则调试器

第二阶段必须补齐，建议展示：

```txt
当前数据：
breaker_001.state = closed
breaker_001.U = 220

命中规则：
running_when_closed 命中
fault_when_voltage_lt_zero 未命中

最终结果：
link_001.state = running
link_001.color = #22c55e
```

## 本阶段验收

- 规则引擎不依赖 GoJS。
- GoJS 模板只绑定 runtime。
- 文本模板能正确渲染。
- 连线规则能根据实时数据切换状态。
- 分组规则能控制显示、背景和边框。
- 调试器能解释为什么命中或未命中。
