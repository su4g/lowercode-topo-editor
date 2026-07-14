<script setup lang="ts">
import { QuestionFilled } from '@element-plus/icons-vue';

defineProps<{
  label: string;
  summary: string;
  items: Array<{ label: string; text: string }>;
}>();
</script>

<template>
  <span class="node-type-tab-help-label">
    <span>{{ label }}</span>
    <el-popover placement="top" :width="360" trigger="click">
      <template #reference>
        <button type="button" class="node-type-tab-help-trigger" :aria-label="`${label}说明`" @click.stop>
          <el-icon><QuestionFilled /></el-icon>
        </button>
      </template>
      <div class="node-type-tab-help-content">
        <div class="node-type-tab-help-summary">{{ summary }}</div>
        <dl class="node-type-tab-help-list">
          <div v-for="item in items" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.text }}</dd>
          </div>
        </dl>
      </div>
    </el-popover>
  </span>
</template>

<style scoped>
.node-type-tab-help-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.node-type-tab-help-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  padding: 0;
  color: var(--el-color-primary, #009688);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.node-type-tab-help-trigger:hover {
  color: var(--el-color-primary-dark-2, #007f71);
  background: var(--el-color-primary-light-9, #e6f4f3);
}

.node-type-tab-help-trigger :deep(.el-icon) {
  font-size: 13px;
}

.node-type-tab-help-content {
  color: var(--el-text-color-regular, #606266);
  font-size: 12px;
  line-height: 1.55;
}

.node-type-tab-help-summary {
  margin-bottom: 8px;
  color: var(--el-text-color-primary, #303133);
  font-weight: 700;
}

.node-type-tab-help-list {
  display: grid;
  gap: 6px;
  margin: 0;
}

.node-type-tab-help-list > div {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 7px;
  padding: 5px 7px;
  background: var(--el-fill-color-lighter, #fafafa);
  border-radius: 5px;
}

.node-type-tab-help-list dt {
  color: var(--el-text-color-primary, #303133);
  font-weight: 600;
}

.node-type-tab-help-list dd {
  margin: 0;
  color: var(--el-text-color-secondary, #909399);
}
</style>
