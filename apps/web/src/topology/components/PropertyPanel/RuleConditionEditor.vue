<script setup lang="ts">
import { computed } from "vue";
import type { DataSourceReference, TopologyNode } from "@topo-editor/topology-shared";
import {
  cloneRuleConditionDraft,
  fieldOptionsForNode,
  type RuleConditionDraft,
  type RuleConditionLogic
} from "./ruleCondition";

const props = defineProps<{
  modelValue: RuleConditionDraft[];
  logic: RuleConditionLogic;
  nodes: TopologyNode[];
  dataSources: DataSourceReference[];
  nodeOptions: Array<{
    value: string;
    label: string;
    children: Array<{ value: string; label: string }>;
  }>;
  allowMetaData?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: RuleConditionDraft[]];
  "update:logic": [value: RuleConditionLogic];
}>();

const cascaderProps = { emitPath: false } as const;
const enabledSources = computed(() => props.dataSources.filter((source) => source.enabled !== false));

function nodeByKey(key: string) {
  return props.nodes.find((node) => node.key === key) ?? null;
}

function fieldOptions(draft: RuleConditionDraft) {
  return fieldOptionsForNode(nodeByKey(draft.nodeKey));
}

function selectedFieldOption(draft: RuleConditionDraft) {
  if (draft.field === "__custom__") return undefined;
  return fieldOptions(draft).find((option) => option.field === draft.field);
}

function updateDraft(index: number, patch: Partial<RuleConditionDraft>) {
  emit("update:modelValue", props.modelValue.map((draft, draftIndex) => (
    draftIndex === index ? { ...draft, ...patch } : draft
  )));
}

function defaultSourceId(node: TopologyNode | null) {
  if (node?.dataBinding?.sourceId && enabledSources.value.some((source) => source.sourceId === node.dataBinding?.sourceId)) {
    return node.dataBinding.sourceId;
  }
  return enabledSources.value[0]?.sourceId ?? "";
}

function showSourceSelect(draft: RuleConditionDraft) {
  return enabledSources.value.length > 1
    || (!!draft.sourceId && !enabledSources.value.some((source) => source.sourceId === draft.sourceId));
}

function updateSourceType(index: number, value: string) {
  const sourceType = value === "metaData" ? "metaData" : "node";
  updateDraft(index, {
    sourceType,
    preserveRawField: false,
    ...(sourceType === "metaData"
      ? { field: "__custom__", customField: "" }
      : { sourceId: defaultSourceId(nodeByKey(props.modelValue[index]?.nodeKey ?? "")) })
  });
}

function updateNode(index: number, nodeKey: string) {
  const draft = props.modelValue[index];
  if (!draft) return;
  const node = nodeByKey(nodeKey);
  const options = fieldOptionsForNode(node);
  const field = options.some((option) => option.field === draft.field)
    ? draft.field
    : options[0]?.field ?? "state";
  updateDraft(index, {
    nodeKey,
    sourceId: defaultSourceId(node),
    field,
    customField: field === "__custom__" ? draft.customField : "",
    preserveRawField: false
  });
}

function updateField(index: number, field: string) {
  const draft = props.modelValue[index];
  if (!draft) return;
  const option = fieldOptions(draft).find((item) => item.field === field);
  updateDraft(index, {
    field,
    customField: field === "__custom__" ? draft.customField : "",
    preserveRawField: false,
    valueType: option?.type === "number" ? "number" : option?.type === "boolean" ? "boolean" : "string",
    ...(option?.options?.length ? { value: String(option.options[0]) } : {}),
    ...(option?.type === "boolean" ? { value: "true" } : {})
  });
}

function addCondition() {
  const previous = props.modelValue[props.modelValue.length - 1];
  if (!previous) return;
  emit("update:modelValue", [...props.modelValue, cloneRuleConditionDraft(previous)]);
}

function removeCondition(index: number) {
  if (props.modelValue.length <= 1) return;
  emit("update:modelValue", props.modelValue.filter((_, draftIndex) => draftIndex !== index));
}
</script>

<template>
  <section class="condition-editor">
    <div class="condition-editor-header">
      <div>
        <div class="condition-editor-title">触发条件</div>
        <div class="condition-editor-note">配置规则生效前需要满足的数据条件</div>
      </div>
      <label class="logic-field">
        条件关系
        <select :value="logic" @change="emit('update:logic', ($event.target as HTMLSelectElement).value as RuleConditionLogic)">
          <option value="and">满足全部（且）</option>
          <option value="or">满足任一（或）</option>
        </select>
      </label>
    </div>

    <div v-for="(draft, index) in modelValue" :key="draft.id" class="condition-card">
      <div class="condition-card-header">
        <strong><span class="condition-index">{{ index + 1 }}</span>条件 {{ index + 1 }}</strong>
        <button class="condition-delete" type="button" :disabled="modelValue.length <= 1" @click="removeCondition(index)">删除</button>
      </div>

      <label v-if="allowMetaData">
        条件来源
        <select :value="draft.sourceType" @change="updateSourceType(index, ($event.target as HTMLSelectElement).value)">
          <option value="metaData">父组件数据 mateData/metaData</option>
          <option value="node">绑定设备节点</option>
        </select>
      </label>

      <template v-if="draft.sourceType === 'node'">
        <label>
          条件节点
          <el-cascader
            class="condition-node-cascader"
            :model-value="draft.nodeKey"
            :options="nodeOptions"
            :props="cascaderProps"
            placeholder="请选择节点"
            @change="updateNode(index, String($event ?? ''))"
          />
        </label>
        <label v-if="showSourceSelect(draft)">
          接口
          <select :value="draft.sourceId" @change="updateDraft(index, { sourceId: ($event.target as HTMLSelectElement).value, preserveRawField: false })">
            <option v-for="source in enabledSources" :key="source.sourceId" :value="source.sourceId">
              {{ source.name || source.sourceId }}（{{ source.sourceId }}）
            </option>
          </select>
        </label>
        <label>
          数据字段
          <select :value="draft.field" @change="updateField(index, ($event.target as HTMLSelectElement).value)">
            <option v-for="field in fieldOptions(draft)" :key="field.field" :value="field.field">
              {{ field.label }}（{{ field.field }}）
            </option>
            <option value="__custom__">自定义字段</option>
          </select>
        </label>
        <label v-if="draft.field === '__custom__'">
          字段名
          <input
            :value="draft.customField"
            placeholder="例如 status / data.qf1.status / ${api1.data.qf1.status}"
            @input="updateDraft(index, { customField: ($event.target as HTMLInputElement).value })"
          />
        </label>
      </template>
      <label v-else>
        父组件字段
        <input
          :value="draft.customField"
          placeholder="例如 qfStatus.button1 / ${mateData.qfStatus.button1}"
          @input="updateDraft(index, { customField: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <label>
        等于
        <select
          v-if="draft.sourceType === 'node' && selectedFieldOption(draft)?.options?.length"
          :value="draft.value"
          @change="updateDraft(index, { value: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="option in selectedFieldOption(draft)?.options" :key="String(option)" :value="String(option)">
            {{ String(option) }}
          </option>
        </select>
        <select
          v-else-if="draft.sourceType === 'node' && selectedFieldOption(draft)?.type === 'boolean'"
          :value="draft.value"
          @change="updateDraft(index, { value: ($event.target as HTMLSelectElement).value, valueType: 'boolean' })"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
        <input
          v-else
          :value="draft.value"
          placeholder="请输入比较值"
          @input="updateDraft(index, { value: ($event.target as HTMLInputElement).value })"
        />
      </label>
    </div>

    <button class="condition-add" type="button" @click="addCondition">+ 新增条件</button>
  </section>
</template>

<style scoped>
.condition-editor {
  display: grid;
  gap: 12px;
  padding: 14px;
  background: #ffffff;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 10px;
}

.condition-editor-header,
.condition-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.condition-editor-header {
  align-items: flex-start;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
}

.condition-editor-title { color: var(--el-text-color-primary, #303133); font-size: 14px; font-weight: 700; }
.condition-editor-note { margin-top: 3px; color: var(--el-text-color-secondary, #909399); font-size: 12px; }

.logic-field {
  width: 172px;
  flex: none;
}

.condition-card {
  display: grid;
  gap: 9px;
  padding: 12px;
  background: var(--el-fill-color-extra-light, #fafcff);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
}

.condition-card-header { padding-bottom: 8px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); }
.condition-card-header strong { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
.condition-index { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; color: var(--el-color-primary, #009688); background: var(--el-color-primary-light-9, #e6f4f3); border-radius: 50%; font-size: 11px; }

.condition-node-cascader {
  width: 100%;
}

label {
  display: grid;
  gap: 6px;
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
}

input,
select {
  width: 100%;
  padding: 7px 10px;
  color: var(--el-text-color-primary, #303133);
  background: #ffffff;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
}

button {
  padding: 7px 12px;
  color: var(--el-text-color-regular, #606266);
  background: #ffffff;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  cursor: pointer;
}

button:disabled {
  color: var(--el-text-color-placeholder, #a8abb2);
  cursor: not-allowed;
}

.condition-delete:not(:disabled) { color: var(--el-color-danger, #f56c6c); }
.condition-add { color: var(--el-color-primary, #009688); background: var(--el-color-primary-light-9, #e6f4f3); border-style: dashed; border-color: var(--el-color-primary-light-7, #b3ded9); }
</style>
