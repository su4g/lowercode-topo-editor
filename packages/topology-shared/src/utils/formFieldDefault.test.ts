import { describe, expect, it } from 'vitest';
import {
  colorFormFieldDefaultValue,
  formFieldDefaultValueError,
  numberFormFieldDefaultValue,
  parseFormFieldDefaultValue,
  parseFormFieldOptions
} from './formFieldDefault';

describe('topology dynamic form defaults', () => {
  it('serializes all supported field types and preserves empty optional defaults', () => {
    expect(parseFormFieldDefaultValue('设备 A', 'text')).toBe('设备 A');
    expect(parseFormFieldDefaultValue('第一行\n第二行', 'textarea')).toBe('第一行\n第二行');
    expect(parseFormFieldDefaultValue('12.5', 'number')).toBe(12.5);
    expect(parseFormFieldDefaultValue('2026-07-10', 'date')).toBe('2026-07-10');
    expect(parseFormFieldDefaultValue('true', 'boolean')).toBe(true);
    expect(parseFormFieldDefaultValue('false', 'boolean')).toBe(false);
    expect(parseFormFieldDefaultValue('是', 'boolean')).toBe(true);
    expect(parseFormFieldDefaultValue('否', 'boolean')).toBe(false);
    expect(parseFormFieldDefaultValue('#12abef', 'color')).toBe('#12abef');
    expect(parseFormFieldDefaultValue('running', 'select')).toBe('running');
    expect(parseFormFieldDefaultValue('', 'number')).toBeUndefined();
    expect(parseFormFieldDefaultValue('', 'boolean')).toBeUndefined();
    expect(parseFormFieldDefaultValue('', 'color')).toBeUndefined();
  });

  it('validates number, date, boolean, and color defaults', () => {
    expect(formFieldDefaultValueError({ type: 'number', defaultValue: 'not-a-number' })).toContain('有效数字');
    expect(formFieldDefaultValueError({ type: 'date', defaultValue: '2026-02-30' })).toContain('有效日期');
    expect(formFieldDefaultValueError({ type: 'boolean', defaultValue: 'maybe' })).toContain('是或否');
    expect(formFieldDefaultValueError({ type: 'color', defaultValue: 'red' })).toContain('#RRGGBB');
    expect(numberFormFieldDefaultValue('12.5')).toBe(12.5);
    expect(numberFormFieldDefaultValue('invalid')).toBeUndefined();
    expect(colorFormFieldDefaultValue('#12abef')).toBe('#12abef');
    expect(colorFormFieldDefaultValue('invalid')).toBeUndefined();
  });

  it('requires select defaults to match a configured option', () => {
    const options = parseFormFieldOptions('停机:stopped\n运行:running');
    expect(formFieldDefaultValueError({ type: 'select', defaultValue: '' }, options)).toContain('选择默认值');
    expect(formFieldDefaultValueError({ type: 'select', defaultValue: 'paused' }, options)).toContain('选项列');
    expect(formFieldDefaultValueError({ type: 'select', defaultValue: 'running' }, options)).toBe('');
    expect(formFieldDefaultValueError({ type: 'select', defaultValue: 'running' })).toContain('至少配置');
  });
});
