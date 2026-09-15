/** "123" / "12.3" / "1.23" — compact visual-control value precision. */
export function formatKnobNumber(value: number): string {
  const absolute = Math.abs(value);
  return absolute >= 100
    ? Math.round(value).toString()
    : absolute >= 10
      ? value.toFixed(1)
      : value.toFixed(2);
}
