# 04-拓扑编辑器落地步骤

## 目标

完成第一版可配置拓扑编辑器：节点库、画布、属性面板、拖拽、连线、分组、保存恢复。

## 步骤 1：加载基础数据

接口：

```txt
GET /api/topology/node-types
GET /api/topologies/:id
```

前端动作：

- 进入编辑器页面时加载节点类型。
- 如果有 topologyId，加载拓扑配置。
- 如果是新建，创建空拓扑。

验收：

- 左侧节点库按 `category` 分组展示节点类型。
- 空拓扑能显示空画布。

## 步骤 2：Palette 拖拽

实现：

- Palette 数据来自节点类型。
- 拖入画布时生成 `TopologyNode`。
- `props` 根据 `formSchema.defaultValue` 初始化。
- `runtime` 根据默认状态初始化。

节点 key 规则：

```txt
typeId + "_" + 自增序号
```

验收：

- 可拖入断路器、文本节点、实验室分组。
- 新节点带默认 label、loc、props。

## 步骤 3：GoJS 模板

必须支持：

- 基础设备节点。
- 文本节点。
- Group 分组节点。
- 端口显示。
- 连线样式。

模板绑定要求：

- label 绑定 `label`。
- 位置绑定 `loc`。
- 可见性绑定 `runtime.visibility.finalVisible`。
- 颜色、边框、文本绑定 `runtime`。

验收：

- 分组可以容纳节点。
- 文本节点展示 `runtime.text` 或默认文本。
- 连线颜色、宽度跟随 `runtime`。

## 步骤 4：连线校验

校验规则：

- 起点、终点节点类型存在。
- 端口存在。
- 端口方向允许。
- 端口最大连接数不超限。
- 连线类型符合限制。
- 不允许重复连接。

GoJS 接入点：

```ts
diagram.toolManager.linkingTool.linkValidation = validateLink;
diagram.toolManager.relinkingTool.linkValidation = validateLink;
```

验收：

- 不符合规则的连线不能创建。
- 失败原因能展示给用户。

## 步骤 5：连线创建后补全数据

在 `LinkDrawn` 事件中补充：

- `key`。
- `linkType`。
- `defaultState`。
- `defaultStyle`。
- `runtime`。

验收：

- 新建连线保存后有稳定 key。
- 刷新后连线仍存在且端口正确。

## 步骤 6：属性面板

选中节点：

- 基础信息：名称、类型、所属分组。
- 动态表单：根据节点类型 `formSchema` 渲染。
- 数据绑定：`sourceId` 和 `mappings`。
- 显示规则。
- 事件配置。

选中连线：

- 名称、连线类型。
- 起点/终点节点与端口。
- 默认颜色、宽度、流线。
- 运行规则。

选中分组：

- 分组名称、背景色、标题样式。
- 允许放入的类型。
- 是否允许嵌套。
- 显示规则。

验收：

- 修改属性后画布实时更新。
- 修改动态表单后保存到 `props`。
- 修改连线规则后保存到 `rules`。

## 步骤 7：保存和恢复

保存前从 GoJS model 提取：

- `nodeDataArray`。
- `linkDataArray`。
- viewport position 和 scale。

接口：

```txt
PUT /api/topologies/:id
```

验收：

- 节点位置可恢复。
- 分组归属可恢复。
- 连线路径可恢复。
- 属性面板配置可恢复。

## 步骤 8：编辑态和运行态切换

编辑态：

- 允许拖拽、连线、删除、属性配置。
- 规则隐藏的对象半透明显示。

运行态：

- 只读。
- 规则隐藏的对象真正隐藏。
- 点击事件对外暴露。

验收：

- 运行态不能拖拽节点。
- 编辑态仍可看见被规则隐藏的对象。
