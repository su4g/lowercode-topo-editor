import type { FormFieldDefinition } from '../types/node-type';

type EditableDefaultField = Pick<FormFieldDefinition, 'type'> & {
  defaultValue: string;
};

function parsePrimitive(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function listFromText(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function booleanDefaultValue(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', '是'].includes(normalized)) return true;
  if (['false', '0', 'no', '否'].includes(normalized)) return false;
  return undefined;
}

function isValidDateValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseFormFieldOptions(value: string): FormFieldDefinition['options'] | undefined {
  const lines = listFromText(value);
  if (!lines.length) return undefined;
  return lines.map((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) return { label: line, value: parsePrimitive(line) };
    const label = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    return { label: label || rawValue, value: parsePrimitive(rawValue) };
  });
}

export function formFieldDefaultValueError(field: EditableDefaultField, options?: FormFieldDefinition['options']): string {
  const value = field.defaultValue.trim();
  if (field.type === 'select') {
    if (!options?.length) return '下拉类型需至少配置一项选项';
    if (!value) return '下拉类型需选择默认值';
    return options.some((option) => String(option.value) === value) ? '' : '默认值必须来自选项列';
  }
  if (!value) return '';
  if (field.type === 'number') return Number.isFinite(Number(value)) ? '' : '默认值必须是有效数字';
  if (field.type === 'boolean') return booleanDefaultValue(value) === undefined ? '默认值必须为是或否' : '';
  if (field.type === 'date') return isValidDateValue(value) ? '' : '默认值必须是 YYYY-MM-DD 格式的有效日期';
  if (field.type === 'color') return /^#[0-9a-f]{6}$/i.test(value) ? '' : '默认值必须是 #RRGGBB 格式的颜色';
  return '';
}

export function parseFormFieldDefaultValue(value: string, type: FormFieldDefinition['type']): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (type === 'number') return Number(trimmed);
  if (type === 'boolean') return booleanDefaultValue(trimmed);
  return trimmed;
}

export function numberFormFieldDefaultValue(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed || !Number.isFinite(Number(trimmed))) return undefined;
  return Number(trimmed);
}

export function colorFormFieldDefaultValue(value: string): string | undefined {
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : undefined;
}
