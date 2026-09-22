import {createErrorSink} from './internal/lifecycle';

/** A final display value, or a callback that renders the supplied context. */
export type UITextValue<Values extends object = Record<string, never>> =
  string | ((values: Values) => string);

/** Application-owned rendering callbacks. No locale or formatting state is stored. */
export interface UIValueFormatters {
  number?: (value: number) => string;
  /** Receives a fraction: 1 means 100 percent. */
  percent?: (fraction: number) => string;
  /** Receives seconds, not a timestamp. */
  time?: (seconds: number) => string;
}

/** Read application display inputs for one paint; never subscribe to their owner. */
export function readText<Text>(getText: (() => Text) | undefined, onError?: (error: unknown) => void): Text | undefined {
  try { return getText?.(); } catch (error) {
    createErrorSink(onError)(error);
    return undefined;
  }
}

/** Select final text. Strings are literal; interpolation belongs to the caller. */
export function textValue<Values extends object>(
  override: UITextValue<Values> | undefined,
  fallback: string,
  values: Values,
  onError?: (error: unknown) => void,
): string {
  if (override === undefined) return fallback;
  try {
    const result = typeof override === 'function' ? override(values) : override;
    if (typeof result !== 'string') throw new TypeError('UI text callback must return a string');
    return result;
  } catch (error) {
    createErrorSink(onError)(error);
    return fallback;
  }
}

function format(
  formatter: ((value: number) => string) | undefined,
  value: number,
  fallback: string,
  onError?: (error: unknown) => void,
): string {
  if (!formatter) return fallback;
  try {
    const result = formatter(value);
    if (typeof result !== 'string') throw new TypeError('UI value formatter must return a string');
    return result;
  } catch (error) {
    createErrorSink(onError)(error);
    return fallback;
  }
}

export function formatNumber(formatters: UIValueFormatters | undefined, value: number, fallback = String(value), onError?: (error: unknown) => void): string {
  return format(formatters?.number, value, fallback, onError);
}

export function formatPercent(formatters: UIValueFormatters | undefined, value: number, fallback = `${Math.round(value * 100)}%`, onError?: (error: unknown) => void): string {
  return format(formatters?.percent, value, fallback, onError);
}

export function formatTime(formatters: UIValueFormatters | undefined, seconds: number, fallback?: string, onError?: (error: unknown) => void): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const text = fallback ?? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  return format(formatters?.time, seconds, text, onError);
}
