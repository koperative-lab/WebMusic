import {describe, expect, it, vi} from 'vitest';
import {bindLocalization, createUILocalization, formatPercent, message} from '../src/localization';

describe('UI localization', () => {
  it('replaces language maps atomically, preserving omitted configuration and resetting explicit undefined', () => {
    const source = {'meter.level': 'Level', 'mixer.master': 'Main'};
    const text = createUILocalization({messages: source, formatters: {percent: value => `${value * 100} pct`}});
    source['meter.level'] = 'mutated outside';
    const observe = vi.fn(() => [message(text, 'meter.level', 'Audio level'), message(text, 'mixer.master', 'master')]);
    const off = text.subscribe(observe);
    expect(message(text, 'meter.level', 'Audio level')).toBe('Level');
    text.update({messages: {'meter.level': '电平'}});
    expect(observe.mock.results[0]?.value).toEqual(['电平', 'master']);
    expect(formatPercent(text, .25)).toBe('25 pct');
    text.update({messages: undefined, formatters: undefined});
    expect(message(text, 'meter.level', 'Audio level')).toBe('Audio level');
    expect(formatPercent(text, .25)).toBe('25%');
    off(); off();
    text.update({messages: {}});
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('supports whole-message reordering, plural callbacks and independent instances', () => {
    const text = createUILocalization({messages: {
      mute: '{label}静音',
      count: ({count}) => count === 1 ? 'one item' : '{count} items',
    }});
    expect(text.message('mute', 'Mute {label}', {label: '<Violin>'})).toBe('<Violin>静音');
    expect(text.message('count', '', {count: 1})).toBe('one item');
    expect(text.message('count', '', {count: 3})).toBe('3 items');
    expect(createUILocalization().message('mute', 'Mute {label}', {label: 'A'})).toBe('Mute A');
  });

  it('falls back after formatter and subscriber failures without preventing other views from updating', async () => {
    const onError = vi.fn(async () => { throw new Error('sink failed'); });
    const text = createUILocalization({
      messages: {bad: () => { throw new Error('message failed'); }},
      formatters: {number: () => { throw new Error('formatter failed'); }},
      onError,
    });
    expect(text.message('bad', 'Safe {value}', {value: 3})).toBe('Safe 3');
    expect(text.formatNumber(3, '3.0')).toBe('3.0');
    text.subscribe(() => { throw new Error('subscriber failed'); });
    const next = vi.fn();
    text.subscribe(next);
    text.update({});
    await Promise.resolve();
    expect(next).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('bounds reentrant updates and lets subscribers unsubscribe during notification', () => {
    const onError = vi.fn();
    const text = createUILocalization({onError});
    const second = vi.fn();
    let offSecond = () => {};
    const offFirst = text.subscribe(() => { offSecond(); text.update({}); });
    offSecond = text.subscribe(second);
    text.update({});
    expect(second).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    offFirst();
    text.update({messages: {ready: 'Ready'}});
    expect(text.message('ready', '')).toBe('Ready');
  });

  it('releases a custom source subscription returned after a synchronous replacement', () => {
    let current = true;
    const release = vi.fn();
    const source = {...createUILocalization(), subscribe: (notify: () => void) => { notify(); return release; }};
    const cleanup = bindLocalization(source, () => { current = false; }, () => current);
    expect(release).toHaveBeenCalledOnce();
    cleanup();
    expect(release).toHaveBeenCalledOnce();
  });
});
