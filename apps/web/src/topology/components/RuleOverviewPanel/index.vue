<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ArrowDown, Close, Search } from '@element-plus/icons-vue';
import type { ConditionTrace, RuleEvaluation, RuleOverviewGroup, RuleStatus } from '@topo-editor/topology-shared';

const props = defineProps<{
  nodeGroups: RuleOverviewGroup[];
  linkGroups: RuleOverviewGroup[];
  selectedKey: string;
}>();

const emit = defineEmits<{
  (event: 'select', key: string): void;
  (event: 'close'): void;
}>();

type Dimension = 'node' | 'link';
type StatusFilter = 'all' | RuleStatus;

const rootRef = ref<HTMLElement | null>(null);
const dimension = ref<Dimension>('node');
const statusFilter = ref<StatusFilter>('all');
const keyword = ref('');
const onlyWithRules = ref(true);
const expandedRules = ref<Set<string>>(new Set());

// 画布 → 面板：选中对象后自动切到对应维度并滚动定位
watch(
  () => props.selectedKey,
  async (key) => {
    if (!key) return;
    const isNode = props.nodeGroups.some((group) => group.key === key);
    const isLink = props.linkGroups.some((group) => group.key === key);
    if (isLink && !isNode) dimension.value = 'link';
    else if (isNode && !isLink) dimension.value = 'node';
    await nextTick();
    rootRef.value?.querySelector('.rule-group.is-selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
);

const statusMeta: Record<RuleStatus, { label: string; short: string }> = {
  active: { label: '已生效', short: '生效' },
  overridden: { label: '被覆盖', short: '覆盖' },
  inactive: { label: '未生效', short: '未生效' }
};

const operatorLabel: Record<string, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: '属于',
  notIn: '不属于',
  exists: '存在',
  empty: '为空'
};

const sourceGroups = computed(() => (dimension.value === 'node' ? props.nodeGroups : props.linkGroups));

const filteredGroups = computed(() => {
  const word = keyword.value.trim().toLowerCase();
  return sourceGroups.value
    .map((group) => {
      const evaluations = statusFilter.value === 'all' ? group.evaluations : group.evaluations.filter((item) => item.status === statusFilter.value);
      return { ...group, evaluations };
    })
    .filter((group) => {
      if (onlyWithRules.value && group.counts.total === 0) return false;
      if (statusFilter.value !== 'all' && group.evaluations.length === 0) return false;
      if (!word) return true;
      const inGroup = group.label.toLowerCase().includes(word) || group.key.toLowerCase().includes(word);
      const inRule = group.evaluations.some((item) => item.name.toLowerCase().includes(word));
      return inGroup || inRule;
    });
});

const totals = computed(() => {
  const groups = sourceGroups.value;
  return groups.reduce(
    (acc, group) => {
      acc.active += group.counts.active;
      acc.overridden += group.counts.overridden;
      acc.inactive += group.counts.inactive;
      return acc;
    },
    { active: 0, overridden: 0, inactive: 0 }
  );
});

function ruleRowKey(groupKey: string, evaluation: RuleEvaluation) {
  return `${groupKey}::${evaluation.ruleId}`;
}

function toggleRule(groupKey: string, evaluation: RuleEvaluation) {
  const id = ruleRowKey(groupKey, evaluation);
  const next = new Set(expandedRules.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedRules.value = next;
}

function isExpanded(groupKey: string, evaluation: RuleEvaluation) {
  return expandedRules.value.has(ruleRowKey(groupKey, evaluation));
}

function formatValue(value: unknown) {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function describeConditionLeaf(trace: ConditionTrace) {
  const operator = operatorLabel[trace.operator ?? ''] ?? trace.operator ?? '';
  if (trace.operator === 'exists' || trace.operator === 'empty') {
    return `${trace.field} ${operator}`;
  }
  return `${trace.field} ${operator} ${formatValue(trace.expected)}`;
}

function isEmptyAction(evaluation: RuleEvaluation) {
  return evaluation.hit && evaluation.effectiveFields.length === 0 && evaluation.overriddenFields.length === 0;
}
</script>

<template>
  <section ref="rootRef" class="rule-overview">
    <header class="rule-overview-bar">
      <div class="rule-overview-title">
        <strong>规则总览</strong>
        <span class="rule-overview-summary">
          <i class="dot dot-active" />{{ totals.active }} <i class="dot dot-overridden" />{{ totals.overridden }} <i class="dot dot-inactive" />{{
            totals.inactive
          }}
        </span>
      </div>
      <el-segmented
        v-model="dimension"
        size="small"
        :options="[
          { label: `节点 (${nodeGroups.length})`, value: 'node' },
          { label: `连线 (${linkGroups.length})`, value: 'link' }
        ]"
      />
      <el-select v-model="statusFilter" size="small" class="rule-overview-status">
        <el-option label="全部状态" value="all" />
        <el-option label="已生效" value="active" />
        <el-option label="被覆盖" value="overridden" />
        <el-option label="未生效" value="inactive" />
      </el-select>
      <el-input v-model="keyword" size="small" class="rule-overview-search" placeholder="搜索对象或规则名" :prefix-icon="Search" clearable />
      <el-checkbox v-model="onlyWithRules" size="small">仅含规则</el-checkbox>
      <span class="rule-overview-spacer" />
      <el-button text size="small" :icon="Close" @click="emit('close')">收起</el-button>
    </header>

    <div class="rule-overview-body">
      <div v-if="!filteredGroups.length" class="rule-overview-empty">暂无匹配的规则。</div>
      <article v-for="group in filteredGroups" :key="group.key" class="rule-group" :class="{ 'is-selected': group.key === selectedKey }">
        <div class="rule-group-head" @click="emit('select', group.key)">
          <div class="rule-group-name">
            <span class="rule-group-label">{{ group.label }}</span>
            <span class="rule-group-type">{{ group.typeName }}</span>
          </div>
          <div class="rule-group-meta">
            <span class="rule-group-state">当前：{{ group.statusText }}</span>
            <span v-if="!group.visible" class="rule-group-hidden">隐藏</span>
            <span class="rule-group-counts">
              <em class="tag tag-active" v-if="group.counts.active">{{ group.counts.active }} 生效</em>
              <em class="tag tag-overridden" v-if="group.counts.overridden">{{ group.counts.overridden }} 覆盖</em>
              <em class="tag tag-inactive" v-if="group.counts.inactive">{{ group.counts.inactive }} 未生效</em>
              <em class="tag tag-none" v-if="!group.counts.total">无规则</em>
            </span>
          </div>
        </div>

        <ul v-if="group.evaluations.length" class="rule-list">
          <li v-for="evaluation in group.evaluations" :key="evaluation.ruleId" class="rule-item" :class="`rule-item-${evaluation.status}`">
            <button type="button" class="rule-item-head" @click="toggleRule(group.key, evaluation)">
              <span class="rule-status" :class="`rule-status-${evaluation.status}`">{{ statusMeta[evaluation.status].short }}</span>
              <span class="rule-priority">P{{ evaluation.priority }}</span>
              <span class="rule-name">{{ evaluation.name || evaluation.ruleId }}</span>
              <span class="rule-fields">
                <em v-for="field in evaluation.effectiveFields" :key="`e-${field}`" class="field field-active">{{ field }}</em>
                <em v-for="field in evaluation.overriddenFields" :key="`o-${field}`" class="field field-overridden">{{ field }}</em>
                <em v-if="isEmptyAction(evaluation)" class="field field-none">空动作</em>
              </span>
              <el-icon class="rule-caret" :class="{ 'is-open': isExpanded(group.key, evaluation) }"><ArrowDown /></el-icon>
            </button>
            <div v-if="isExpanded(group.key, evaluation)" class="rule-conditions">
              <div v-if="!evaluation.conditions.length" class="rule-conditions-empty">无条件（恒成立）</div>
              <template v-else>
                <div
                  v-for="(trace, index) in evaluation.conditions"
                  :key="index"
                  class="condition-line"
                  :class="{ 'is-pass': trace.passed, 'is-fail': !trace.passed }"
                >
                  <template v-if="trace.children">
                    <span class="condition-group-logic">{{ trace.logic === 'or' ? '或' : '且' }} 分组 {{ trace.passed ? '✓' : '✗' }}</span>
                    <div class="condition-nested">
                      <div
                        v-for="(child, childIndex) in trace.children"
                        :key="childIndex"
                        class="condition-line"
                        :class="{ 'is-pass': child.passed, 'is-fail': !child.passed }"
                      >
                        <span class="condition-expr">{{ describeConditionLeaf(child) }}</span>
                        <span class="condition-actual">实际 {{ formatValue(child.actual) }}</span>
                        <span class="condition-mark">{{ child.passed ? '✓' : '✗' }}</span>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <span class="condition-expr">{{ describeConditionLeaf(trace) }}</span>
                    <span class="condition-actual">实际 {{ formatValue(trace.actual) }}</span>
                    <span class="condition-mark">{{ trace.passed ? '✓' : '✗' }}</span>
                  </template>
                </div>
              </template>
            </div>
          </li>
        </ul>
        <div v-else class="rule-list-empty">该对象暂无规则。</div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.rule-overview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: #ffffff;
  border-top: 1px solid #d8dde6;
}

.rule-overview-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.rule-overview-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #111827;
}

.rule-overview-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-size: 12px;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border-radius: 50%;
}

.dot-active {
  background: #16a34a;
}
.dot-overridden {
  background: #d97706;
}
.dot-inactive {
  background: #94a3b8;
}

.rule-overview-status {
  width: 120px;
}
.rule-overview-search {
  width: 180px;
}
.rule-overview-spacer {
  flex: 1;
}

.rule-overview-body {
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rule-overview-empty {
  padding: 24px;
  color: #94a3b8;
  text-align: center;
}

.rule-group {
  /* flex 容器内禁止被压缩，否则高度受限时分组会塌成细条 */
  flex: 0 0 auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.rule-group.is-selected {
  border-color: #38bdf8;
  box-shadow: 0 0 0 1px #bae6fd;
}

.rule-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: #f8fafc;
  cursor: pointer;
}

.rule-group-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rule-group-label {
  color: #0f172a;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-group-type {
  padding: 1px 6px;
  color: #155e75;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
  border-radius: 5px;
  font-size: 11px;
}

.rule-group-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 12px;
}

.rule-group-hidden {
  padding: 1px 6px;
  color: #b91c1c;
  background: #fee2e2;
  border-radius: 5px;
  font-size: 11px;
}

.rule-group-counts {
  display: inline-flex;
  gap: 4px;
}

.tag {
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-style: normal;
}

.tag-active {
  color: #166534;
  background: #dcfce7;
}
.tag-overridden {
  color: #92400e;
  background: #fef3c7;
}
.tag-inactive {
  color: #475569;
  background: #e2e8f0;
}
.tag-none {
  color: #94a3b8;
  background: #f1f5f9;
}

.rule-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.rule-item {
  border-top: 1px solid #eef2f7;
}

.rule-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  background: #ffffff;
  border: none;
  cursor: pointer;
  text-align: left;
}

.rule-item-head:hover {
  background: #f8fafc;
}

.rule-status {
  flex: none;
  width: 44px;
  padding: 2px 0;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}

.rule-status-active {
  color: #166534;
  background: #dcfce7;
}
.rule-status-overridden {
  color: #92400e;
  background: #fef3c7;
}
.rule-status-inactive {
  color: #64748b;
  background: #e2e8f0;
}

.rule-priority {
  flex: none;
  color: #94a3b8;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.rule-name {
  flex: 1;
  min-width: 0;
  color: #1e293b;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-fields {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

.field {
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-style: normal;
}

.field-active {
  color: #166534;
  background: #dcfce7;
}
.field-overridden {
  color: #92400e;
  background: #fef3c7;
  text-decoration: line-through;
}
.field-none {
  color: #94a3b8;
  background: #f1f5f9;
}

.rule-caret {
  flex: none;
  color: #94a3b8;
  transition: transform 0.15s ease;
}

.rule-caret.is-open {
  transform: rotate(180deg);
}

.rule-conditions {
  display: grid;
  gap: 4px;
  padding: 6px 12px 10px 56px;
  background: #f8fafc;
}

.rule-conditions-empty {
  color: #94a3b8;
  font-size: 12px;
}

.condition-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.condition-expr {
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.condition-actual {
  color: #64748b;
}

.condition-mark {
  font-weight: 700;
}

.condition-line.is-pass .condition-mark {
  color: #16a34a;
}
.condition-line.is-fail .condition-mark {
  color: #dc2626;
}
.condition-line.is-fail .condition-expr {
  color: #b91c1c;
}

.condition-group-logic {
  color: #475569;
  font-size: 12px;
  font-weight: 600;
}

.condition-nested {
  display: grid;
  gap: 4px;
  margin-top: 4px;
  padding-left: 14px;
  border-left: 2px solid #e2e8f0;
}

.rule-list-empty {
  padding: 8px 12px;
  color: #94a3b8;
  font-size: 12px;
  border-top: 1px solid #eef2f7;
}
</style>
