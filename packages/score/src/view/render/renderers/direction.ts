import type {ScoreViewDirection} from '../../core/types';

/** Keep invalid browser/JavaScript inputs on the surface's native direction. */
export function viewDirection(value: unknown, fallback: ScoreViewDirection): ScoreViewDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right' ? value : fallback;
}

export function horizontalDirection(direction: ScoreViewDirection): boolean {
  return direction === 'left' || direction === 'right';
}
