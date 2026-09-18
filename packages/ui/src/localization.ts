import {createErrorSink} from './internal/lifecycle';

export type UIMessageValues = Readonly<Record<string, string | number>>;
export type UIMessage = string | ((values: UIMessageValues) => string);

export interface UIFormatters {
  number?: (value: number) => string;
  /** Receives a fraction, where 1 means 100 percent. */
  percent?: (fraction: number) => string;
  /** Receives seconds, never a timestamp or a formatted clock string. */
  time?: (seconds: number) => string;
}

export interface UILocalizationOptions {
  /** Presenter-scoped keys; strings interpolate named {values}. */
  messages?: Readonly<Record<string, UIMessage>>;
  formatters?: UIFormatters;
  /** Translation/formatting/notification failures fall back and are reported here. */
  onError?: (error: unknown) => void;
}

/** A borrowed, instance-local text source; it owns no DOM or musical state. */
export interface UILocalization {
  message(key: string, fallback: string, values?: UIMessageValues): string;
  formatNumber(value: number, fallback: string): string;
  formatPercent(fraction: number, fallback: string): string;
  formatTime(seconds: number, fallback: string): string;
  /** Notifications do not run immediately on subscribing. */
  subscribe(notify: () => void): () => void;
}

export interface UILocalizationController extends UILocalization {
  /**
   * Replace each supplied messages/formatters map atomically. Omitted fields
   * retain their values; explicit undefined restores defaults. Does not remount UI.
   */
  update(options: UILocalizationOptions): void;
}

function interpolate(template: string, values: UIMessageValues): string {
  return template.replace(/\{([\w]+)\}/g, (token, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token);
}

/** Share this object among related presenters; the application owns language selection. */
export function createUILocalization(options: UILocalizationOptions = {}): UILocalizationController {
  let messages = {...options.messages};
  let formatters = {...options.formatters};
  let report = createErrorSink(options.onError);
  const listeners = new Set<() => void>();
  let notifying = false;
  let pending = false;

  const format = (kind: keyof UIFormatters, value: number, fallback: string): string => {
    const formatter = formatters[kind];
    if (!formatter) return fallback;
    try {
      const result = formatter(value);
      if (typeof result !== 'string') throw new TypeError(`UI ${kind} formatter must return a string`);
      return result;
    } catch (error) {
      report(error);
      return fallback;
    }
  };

  return {
    message(key, fallback, values = {}) {
      const defaultText = interpolate(fallback, values);
      if (!Object.prototype.hasOwnProperty.call(messages, key)) return defaultText;
      try {
        const entry = messages[key];
        const text = typeof entry === 'function' ? entry(values) : entry;
        if (typeof text !== 'string') throw new TypeError(`UI message ${key} must resolve to a string`);
        return interpolate(text, values);
      } catch (error) {
        report(error);
        return defaultText;
      }
    },
    formatNumber: (value, fallback) => format('number', value, fallback),
    formatPercent: (value, fallback) => format('percent', value, fallback),
    formatTime: (value, fallback) => format('time', value, fallback),
    subscribe(notify) {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    update(patch) {
      if (Object.prototype.hasOwnProperty.call(patch, 'messages')) messages = {...patch.messages};
      if (Object.prototype.hasOwnProperty.call(patch, 'formatters')) formatters = {...patch.formatters};
      if (Object.prototype.hasOwnProperty.call(patch, 'onError')) report = createErrorSink(patch.onError);
      pending = true;
      if (notifying) return;
      notifying = true;
      try {
        let passes = 0;
        do {
          pending = false;
          for (const listener of [...listeners]) {
            if (!listeners.has(listener)) continue;
            try { listener(); } catch (error) { report(error); }
          }
          passes += 1;
        } while (pending && passes < 32);
        if (pending) report(new Error('UI localization updates did not stabilize after 32 passes'));
      } finally {
        pending = false;
        notifying = false;
      }
    },
  };
}

// Shared implementation helpers. Public consumers use the controller above.
export function message(localization: UILocalization | undefined, key: string, fallback: string, values: UIMessageValues = {}): string {
  return localization?.message(key, fallback, values) ?? interpolate(fallback, values);
}

export function formatNumber(localization: UILocalization | undefined, value: number, fallback = String(value)): string {
  return localization?.formatNumber(value, fallback) ?? fallback;
}

export function formatPercent(localization: UILocalization | undefined, fraction: number, fallback = `${Math.round(fraction * 100)}%`): string {
  return localization?.formatPercent(fraction, fallback) ?? fallback;
}

export function formatTime(localization: UILocalization | undefined, seconds: number, fallback?: string): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const text = fallback ?? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  return localization?.formatTime(seconds, text) ?? text;
}

/** Guard callbacks and release a subscription returned after a synchronous replacement. */
export function bindLocalization(
  localization: UILocalization | undefined,
  refresh: () => void,
  isActive: () => boolean,
  onError?: (error: unknown) => void,
): () => void {
  let active = true;
  let unsubscribe: (() => void) | undefined;
  const report = createErrorSink(onError);
  const cleanup = (): void => {
    active = false;
    const release = unsubscribe;
    unsubscribe = undefined;
    try { release?.(); } catch (error) { report(error); }
  };
  if (!localization || !isActive()) return cleanup;
  try {
    unsubscribe = localization.subscribe(() => {
      if (!active || !isActive()) return;
      try { refresh(); } catch (error) { report(error); }
    });
    if (!active || !isActive()) cleanup();
  } catch (error) {
    report(error);
  }
  return cleanup;
}
