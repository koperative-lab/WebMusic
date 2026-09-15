import type {Rack} from '../../headless/rack';

/**
 * How a mixing desk tells the player wrapping it which rack to drive.
 *
 * ```html
 * <score-player>              <!-- the transport -->
 *   <rack-control></rack-control>   <!-- the desk, over a headless Rack -->
 * </score-player>
 * ```
 *
 * The rack's MEMBERS are headless — a member is a score and a sound, not an
 * element — so nothing below the desk is a custom element. Only this one hop is
 * a DOM concern: which rack the transport above should take.
 *
 * The desk announces, and the player also pulls at its own mount. Both, because
 * custom-element upgrade is grouped by tag rather than by tree position: this
 * package's demo defines `score-player` before `rack-control`, so
 * whichever half of the exchange happens depends on which tag was defined
 * first, and neither half is guaranteed to be the one that lands.
 */

/** Tag a player looks for below it. */
export const RACK_DESK_TAG = 'rack-control';

/** Bubbles from a desk when its rack changes. */
export const RACK_SHARE_EVENT = 'webscore:rack';

export interface RackShareDetail {
  rack: Rack | undefined;
}

/** Bubbles from a part when its declaration changes; the desk reconciles. */
export const RACK_PART_EVENT = 'webscore:rack-part';

/** What a declared part contributes to the rack its desk owns. */
export interface RackPartDeclaration {
  id: string;
  score: import('../../../core').Score;
  sound?: import('../../headless/audio-contracts').HeadlessSynth;
}

export interface RackPartElementLike extends Element {
  /** The declaration, or undefined until this part has resolved a score. */
  rackPartDeclaration(): RackPartDeclaration | undefined;
}

export function isRackPart(node: Element): node is RackPartElementLike {
  return typeof (node as {rackPartDeclaration?: unknown}).rackPartDeclaration === 'function';
}

/** Whether this node is the desk a part belongs to. */
export function isRackDesk(node: Element): boolean {
  return node.tagName.toLowerCase() === RACK_DESK_TAG;
}
