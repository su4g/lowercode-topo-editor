# 00-实施总览

## 目标

建设一个基于 `gojs@2.3.10` 的拖拽配置拓扑系统，包含 Vue 3 前端编辑器、Node.js 后端配置服务、运行态数据聚合与规则计算能力。

系统不是静态画图工具，而是支持配置、运行、联动和扩展的拓扑平台。

## 总体模块

```txt
节点类型管理 -> 拓扑编辑器 -> 拓扑配置 JSON -> 运行态拓扑
数据源管理 -> 数据聚合服务 -> 运行态数据池 -> 绑定/规则引擎
外部业务系统 -> TopologyController -> GoJS Diagram
GoJS Diagram -> TopologyEventEmitter -> 外部业务系统
```

## 项目结构建议

```txt
topo-editor/
  apps/
    web/                 # Vue 3 前端
    server/              # Node.js 后端
  packages/
    topology-shared/     # 共享类型、校验 schema、工具函数
  docs/
  package.json
  pnpm-workspace.yaml
```

第一版可以先建 monorepo，避免前后端类型重复定义。

## 分阶段落地

### 阶段 1：工程骨架与共享模型

任务：

- 初始化 pnpm workspace。
- 建立 `apps/web`、`apps/server`、`packages/topology-shared`。
- 定义拓扑核心类型：节点类型、端口、节点实例、连线实例、规则、数据源。
- 建立 JSON Schema 或 Zod Schema，用于前后端共同校验。

产出：

- 可启动的 Vue 3 项目。
- 可启动的 Node.js API 项目。
- 共享类型包。
- 示例拓扑 JSON。

验收：

- 前后端均可通过 `pnpm dev` 启动。
- 前端可 import 共享类型。
- 后端可用共享 schema 校验示例拓扑。

### 阶段 2：后端配置服务

任务：

- 节点类型 CRUD。
- 数据源 CRUD。
- 拓扑 CRUD。
- 拓扑版本管理。
- 运行态聚合 mock 接口。

产出：

- 数据表迁移脚本。
- REST API。
- OpenAPI 或接口文档。
- 种子数据。

验收：

- 可新增“断路器”“实验室”“文本”三类节点。
- 可保存并读取一张拓扑。
- 可返回 `device_1001.voltage`、`breakerState` 等 mock 运行数据。

### 阶段 3：前端编辑器 MVP

任务：

- 顶部工具栏。
- 左侧节点库 Palette。
- 中间 GoJS 画布。
- 右侧属性面板。
- 节点拖拽、移动、分组、连线。
- 保存和加载拓扑 JSON。

产出：

- `TopologyCanvas` 组件。
- `PalettePanel`、`PropertyPanel`。
- GoJS 模板和 model adapter。

验收：

- 可拖拽断路器到实验室分组中。
- 可从断路器端口拉线。
- 保存后刷新页面能恢复节点、分组、连线和位置。

### 阶段 4：数据绑定与规则引擎

任务：

- 运行态数据池。
- 文本模板渲染。
- 连线运行规则。
- 分组显示规则。
- 批量更新 GoJS model。

产出：

- `bindingEngine`。
- `ruleEngine`。
- `runtimeDataPool`。
- 规则编辑器基础版。

验收：

- `电压：${U} V` 能根据接口返回值更新。
- 断路器闭合后连线变成运行态。
- 电压异常时连线变红。
- 告警数为 0 时实验室运行态隐藏。

### 阶段 5：运行态控制与事件系统

任务：

- 暴露 `TopologyCanvasApi`。
- 暴露 `TopologyEvent`。
- 支持外部事件控制分组、节点、连线 runtime。
- 运行态只读。

产出：

- `controller.ts`。
- `eventEmitter.ts`。
- 运行态页面。

验收：

- 外部可调用 `setGroupVisible`。
- 外部可调用 `focusNode`。
- 点击节点能收到 `NODE_CLICK`。

### 阶段 6：校验、发布与权限

任务：

- 保存前轻校验。
- 发布前强校验。
- 操作日志。
- 基础权限点。
- 规则调试器。

产出：

- 校验报告。
- 发布流程。
- 权限中间件。
- 规则调试面板。

验收：

- 错误端口、缺失节点类型、未映射模板变量能被拦截。
- 发布版本不可被直接覆盖。
- 操作日志能追踪关键变更。
