<script setup lang="ts">
import JsonEditorVue from 'json-editor-vue';
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: Record<string, unknown>;
    placeholder?: string;
    height?: string | number;
    readonly?: boolean;
    label?: string;
  }>(),
  {
    placeholder: '',
    height: 180,
    readonly: false,
    label: ''
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>];
  invalid: [message: string];
}>();

const editorText = ref(stringifyObject(props.modelValue));
const lastModelText = ref(editorText.value);
const errorMessage = ref('');

const editorStyle = computed(() => {
  const height = typeof props.height === 'number' ? `${props.height}px` : props.height;
  return {
    minHeight: height,
    height
  };
});

watch(
  () => props.modelValue,
  (value) => {
    const nextText = stringifyObject(value);
    if (nextText === lastModelText.value) return;
    lastModelText.value = nextText;
    editorText.value = nextText;
    errorMessage.value = '';
  },
  { deep: true }
);

function stringifyObject(value: unknown) {
  return JSON.stringify(isPlainObject(value) ? value : {}, null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function updateEditorValue(value: unknown) {
  const text = typeof value === 'string' ? value : stringifyObject(value);
  editorText.value = text;

  if (!text.trim()) {
    errorMessage.value = '';
    lastModelText.value = stringifyObject({});
    emit('update:modelValue', {});
    return;
  }

  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      const message = '请输入 JSON 对象';
      errorMessage.value = message;
      emit('invalid', message);
      return;
    }
    errorMessage.value = '';
    lastModelText.value = stringifyObject(parsed);
    emit('update:modelValue', parsed);
  } catch {
    const message = 'JSON 格式不正确';
    errorMessage.value = message;
    emit('invalid', message);
  }
}
</script>

<template>
  <div class="json-text-editor" :class="{ 'is-invalid': errorMessage }">
    <div v-if="label" class="json-text-editor-label">{{ label }}</div>
    <JsonEditorVue
      :model-value="editorText"
      :mode="'text' as any"
      :stringified="true"
      :main-menu-bar="false"
      :navigation-bar="false"
      :status-bar="false"
      :read-only="readonly"
      :ask-to-format="false"
      :style="editorStyle"
      class="json-text-editor-body"
      @update:model-value="updateEditorValue"
    />
    <div v-if="placeholder && !editorText.trim()" class="json-text-editor-placeholder">{{ placeholder }}</div>
    <div v-if="errorMessage" class="json-text-editor-error">{{ errorMessage }}</div>
  </div>
</template>

<style scoped>
.json-text-editor {
  position: relative;
  display: grid;
  gap: 6px;
}

.json-text-editor-label {
  color: #4b5563;
  font-size: 13px;
}

.json-text-editor-body {
  overflow: hidden;
  border: 1px solid #d8dde6;
  border-radius: 6px;
}

.json-text-editor :deep(.jse-main) {
  min-height: inherit;
  border: 0;
}

.json-text-editor :deep(.jse-text-mode) {
  background: #f9fafb;
}

.json-text-editor :deep(.cm-editor) {
  min-height: inherit;
  background: #f9fafb;
}

.json-text-editor :deep(.cm-content) {
  color: #111827;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.json-text-editor.is-invalid .json-text-editor-body {
  border-color: #dc2626;
}

.json-text-editor-placeholder {
  position: absolute;
  top: 36px;
  left: 40px;
  max-width: calc(100% - 56px);
  color: #9ca3af;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  pointer-events: none;
}

.json-text-editor-error {
  color: #dc2626;
  font-size: 12px;
}
</style>
