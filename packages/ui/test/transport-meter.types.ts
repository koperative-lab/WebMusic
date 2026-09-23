import {mountMeter, type MeterBinding, type MeterOptions} from '../src/meter';
import {mountTransport, type TransportBinding} from '../src/transport';

declare const host: HTMLElement;
declare const options: MeterOptions;
declare const complete: MeterBinding;
const level = {readLevel: () => ({level: .2})};
const spectrum = {readSpectrum: () => [.4]};
mountMeter(host, level);
mountMeter(host, level, {mode: 'level'});
mountMeter(host, spectrum, {mode: 'spectrum'});
mountMeter(host, complete, options);
// @ts-expect-error Spectrum mode must have the spectrum port.
mountMeter(host, level, {mode: 'spectrum'});
// @ts-expect-error Default level mode must have the level port.
mountMeter(host, spectrum);
// @ts-expect-error A runtime-selected mode requires both ports.
mountMeter(host, level, options);
const minimal: TransportBinding = {
  snapshot: () => ({playing: false}), play() {}, pause() {},
};
mountTransport(host, minimal);

mountTransport(host, minimal, {getText: () => ({play: 'Play', seekValue: ({progress, seeking}) => `${progress} ${seeking}`})});
mountMeter(host, level, {getText: () => ({levelValue: ({level, value}) => `${level}: ${value}`})});
// @ts-expect-error Text supply uses presenter-owned fields rather than translation key registries.
mountTransport(host, minimal, {getText: () => ({'transport.play': 'Play'})});
// @ts-expect-error UI does not accept a localization engine/controller.
mountTransport(host, minimal, {localization: {subscribe() { return () => {}; }}});
