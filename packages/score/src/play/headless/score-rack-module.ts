import {RackModule, type ModuleContext, type RackChannel} from '@webmusic/kernel/module';
import type {Effect} from './effects';

let nextRackId = 0;

/** A Score Rack channel; the neutral Kernel Rack owns its fields (DEC-068). */
export type ScoreRackModuleChannel = RackChannel;

/**
 * Score's hierarchical audio bus: the neutral Kernel {@link RackModule} with
 * Score effect recipes on its master compatibility slot. Borrowing a module
 * never transfers its lifetime.
 */
export class ScoreRackModule extends RackModule {
  constructor(upstream: ModuleContext, options: {id?: string; effect?: Effect; onError?: (error: unknown) => void} = {}) {
    super(upstream, {...options, id: options.id ?? `score-rack-module-${++nextRackId}`});
  }

  override get effect(): Effect | undefined { return super.effect as Effect | undefined; }
  override setEffect(effect: Effect | undefined): void { super.setEffect(effect); }
}
