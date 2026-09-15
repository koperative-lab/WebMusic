// Re-export seam: the implementation lives in the shared kernel and is
// resolved at runtime from the @webmusic/kernel peer (the build
// externalizes it, so every package shares one kernel instance).
export {EventEmitter, type EventListenerFailureMode} from '@webmusic/kernel/events';
