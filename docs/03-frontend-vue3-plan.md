# 03-前端工程落地方案

## 目标

使用 Vue 3 + TypeScript + GoJS 2.3.10 建设拓扑编辑器和运行态页面。

## 前端目录

```txt
apps/web/src/
  topology/
    components/
      TopologyCanvas/
        index.vue
        useTopologyDiagram.ts
        templates/
          equipmentTemplate.ts
          transformerTemplate.ts
          busbarTemplate.ts
          groupTemplate.ts
          textTemplate.ts
          linkTemplate.ts
      PalettePanel/
      PropertyPanel/
      RuleEditor/
      DataBindingEditor/
    core/
      controller.ts
      eventEmitter.ts
      modelAdapter.ts
      runtimeDataPool.ts
      bindingEngine.ts
      ruleEngine.ts
      connectionValidator.ts
      visibility.ts
    pages/
      TopologyEditorPage.vue
      TopologyRuntimePage.vue
    services/
      topologyApi.ts
      nodeTypeApi.ts
      runtimeApi.ts
    stores/
      topologyEditorStore.ts
      topologyRuntimeStore.ts
```

## 页面布局

编辑器页面：

```txt
顶部工具栏
左侧节点库 | 主拓扑画布 | 右侧属性面板
```

顶部工具栏功能：

- 编辑/运行预览切换。
- 保存。
- 撤销、重做。
- 校验。
- 导入、导出。
- 发布。

右侧属性面板按选中对象切换：

- 节点：基础配置、动态表单、数据绑定、显示规则、事件配置。
- 连线：基础配置、默认样式、运行规则。
- 分组：基础配置、容器能力、显示规则。
- 画布：拓扑名称、数据源引用、全局规则。

## 状态管理

建议拆两个 store：

### `topologyEditorStore`

职责：

- 当前拓扑。
- 节点类型列表。
- 当前选中对象。
- 编辑态 dirty 状态。
- 保存、加载、校验、发布。

### `topologyRuntimeStore`

职责：

- 当前拓扑。
- 运行态数据池。
- 轮询或订阅状态。
- 外部控制事件入口。

## `TopologyCanvas` 组件约定

```ts
export type TopologyCanvasProps = {
  mode: "edit" | "runtime";
  topologyData: TopologyData;
  nodeTypes: NodeTypeDefinition[];
  runtimeData?: Record<string, unknown>;
  onReady?: (api: TopologyCanvasApi) => void;
  onEvent?: (event: TopologyEvent) => void;
  onChange?: (topology: TopologyData) => void;
};
```

组件职责：

- 初始化 GoJS Diagram。
- 注册模板、工具、事件。
- 接收 topologyData 并渲染。
- 通过 `onChange` 输出变更后的拓扑 JSON。
- 通过 `onReady` 暴露受控 API。

不负责：

- 调接口。
- 写业务规则。
- 判断设备状态。
- 弹业务详情。

## GoJS 模板分层

第一版模板：

| 模板 | 适用类型 |
|---|---|
| `basicEquipmentTemplate` | 开关、断路器、传感器、仪表、负载 |
| `transformerTemplate` | 变压器 |
| `busbarTemplate` | 母线 |
| `containerGroupTemplate` | 实验室、区域、产线、柜体 |
| `textTemplate` | 文本节点 |
| `linkTemplate` | 电力线、信号线、逻辑线 |

落地要求：

- 不要为每一种设备写一个新模板。
- 设备差异尽量来自 `NodeTypeDefinition` 和 `props`。
- 运行态样式统一绑定 `runtime`。

## GoJS Model 配置

```ts
diagram.model = new go.GraphLinksModel({
  linkKeyProperty: "key",
  linkFromPortIdProperty: "fromPort",
  linkToPortIdProperty: "toPort",
  nodeDataArray: topology.nodes,
  linkDataArray: topology.links
});
```

必须启用：

- `linkKeyProperty`：支持按 key 更新连线。
- `linkFromPortIdProperty`、`linkToPortIdProperty`：支持端口连接。
- `location` 双向绑定：保存节点位置。
- `points` 双向绑定：保存连线路径。

## 前端实现顺序

1. 初始化 Vue 3 工程。
2. 接入 GoJS，渲染空画布。
3. 注册基础节点模板。
4. 注册分组模板。
5. 注册连线模板。
6. 实现 Palette。
7. 实现属性面板基础字段。
8. 实现动态表单。
9. 实现数据绑定编辑器。
10. 实现规则编辑器。
11. 实现运行态页面。

## 前端验收

- 编辑态支持拖拽、连线、删除、撤销重做。
- 运行态只读。
- 选中节点、连线、分组时属性面板正确切换。
- 保存后能恢复位置、分组、端口和连线路径。
- 节点点击事件不暴露 GoJS 原始对象，只暴露业务事件。
