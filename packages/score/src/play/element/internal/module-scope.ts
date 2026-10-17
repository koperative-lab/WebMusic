import type {ModuleContext} from '@webmusic/kernel/module';

/** Republishing a parent's target must not rebuild an unrelated child engine. */
export function sameModuleScope(left: ModuleContext | undefined, right: ModuleContext | undefined): boolean {
  return !!left && !!right && left.audio === right.audio && left.session === right.session &&
    left.registry === right.registry && left.admit === right.admit && left.destination === right.destination;
}
