# 07-校验发布与权限

## 目标

保证拓扑配置可保存、可发布、可追踪、可控权，避免错误配置进入运行态。

## 保存前轻校验

触发时机：

- 用户点击保存。
- 自动保存。
- 导入拓扑 JSON。

校验项：

- 节点 key 唯一。
- 连线 key 唯一。
- 连线起点和终点存在。
- 端口存在。
- 节点类型存在。
- 动态表单必填字段完整。
- 分组引用存在。

保存策略：

- error 阻止保存。
- warning 允许保存，但在报告中展示。

## 发布前强校验

触发时机：

- 用户点击发布。
- 后端发布接口。

校验项：

- 保存前轻校验全部通过。
- 连接规则全部通过。
- 数据源可访问。
- 映射字段存在。
- 文本模板变量都有映射。
- 规则字段存在。
- 分组引用有效。
- 不存在循环依赖规则。
- 关键设备不能孤立。

发布策略：

- error 阻止发布。
- warning 允许发布但必须确认。
- 发布版本不可直接覆盖。

## 校验报告

统一结构：

```ts
export type ValidationReport = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type ValidationIssue = {
  level: "error" | "warning";
  targetType: "topology" | "node" | "link" | "group" | "rule" | "dataSource";
  targetKey?: string;
  message: string;
  suggestion?: string;
};
```

示例：

```json
{
  "valid": false,
  "errors": [
    {
      "level": "error",
      "targetType": "link",
      "targetKey": "link_001",
      "message": "连线目标端口 lv 不存在"
    }
  ],
  "warnings": [
    {
      "level": "warning",
      "targetType": "node",
      "targetKey": "text_001",
      "message": "文本模板变量 ${U} 未配置映射"
    }
  ]
}
```

## 发布流程

```txt
编辑器保存草稿
  -> 后端轻校验
  -> 保存拓扑版本
  -> 用户点击发布
  -> 后端强校验
  -> 生成发布版本
  -> 更新 topology.current_version_id
  -> 写操作日志
  -> 运行态读取发布版本
```

## 权限点

| 权限 | 含义 |
|---|---|
| `topology:view` | 查看拓扑 |
| `topology:edit` | 编辑拓扑 |
| `topology:publish` | 发布拓扑 |
| `topology:delete` | 删除拓扑 |
| `nodeType:manage` | 管理节点类型 |
| `dataSource:manage` | 管理数据源 |
| `runtime:control` | 外部控制运行态 |
| `device:operate` | 操作设备状态 |

第一版最少实现：

- 查看。
- 编辑。
- 发布。
- 节点类型管理。

## 外部事件安全

必须限制：

- 哪些页面或模块可以调用外部控制。
- 哪些事件类型允许调用。
- 是否允许隐藏敏感分组。
- 是否允许设置节点运行态。
- 是否记录操作日志。

禁止：

- 外部系统传入任意 JS 表达式。
- 外部系统直接写拓扑配置 JSON。
- 外部系统绕过权限调用运行态控制。

## 操作日志

记录字段：

- 操作类型。
- 操作描述。
- 拓扑 ID。
- 操作前 JSON。
- 操作后 JSON。
- 操作人。
- 操作时间。

关键操作：

- 保存拓扑。
- 发布拓扑。
- 修改节点类型。
- 修改数据源。
- 删除拓扑。
- 外部控制分组显示隐藏。

## 本阶段验收

- 保存错误配置时能看到报告。
- 发布前能拦截端口、规则、映射错误。
- 发布版本可回溯。
- 不同权限用户看到的操作入口不同。
- 外部控制调用有日志。
