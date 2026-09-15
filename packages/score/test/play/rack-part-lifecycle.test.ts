// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Score} from '../../src/core';
const loads = vi.hoisted(() => [] as Array<{signal: AbortSignal; resolve(score: Score): void}>);
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: vi.fn((_src: string, {signal}: {signal: AbortSignal}) =>
  new Promise<Score>((resolve) => { loads.push({signal, resolve}); }))}));
import {loadScoreFromUrl} from '../../src/io/load';
import {defineRackPartElement, type RackPartElement} from '../../src/play/element/rack-part';
defineRackPartElement();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => { document.body.replaceChildren(); loads.length = 0; vi.clearAllMocks(); });
function mount() {
  const desk = document.createElement('rack-control');
  const part = document.createElement('rack-part') as RackPartElement;
  part.setAttribute('src', '/first.mid');
  desk.append(part);
  document.body.append(desk);
  return {desk, part};
}

describe('Rack part declaration lifetime', () => {
  it('announces an id change without refetching its score or changing its sound', async () => {
    const {desk, part} = mount();
    await flush();
    loads[0]!.resolve({} as Score);
    await flush();
    const first = part.rackPartDeclaration();
    const changed = vi.fn();
    desk.addEventListener('webscore:rack-part', changed);
    part.id = 'renamed';
    expect(changed).toHaveBeenCalledOnce();
    expect(part.rackPartDeclaration()).toEqual({...first, id: 'renamed'});
    expect(loadScoreFromUrl).toHaveBeenCalledOnce();
  });
  it('aborts replaced and detached loads, ignoring stale completions', async () => {
    const {part} = mount();
    await flush();
    part.setAttribute('src', '/next.mid');
    expect(loads[0]!.signal.aborted).toBe(true);
    await flush();
    loads[0]!.resolve({id: 'old'} as unknown as Score);
    await flush();
    expect(part.rackPartDeclaration()).toBeUndefined();
    part.remove();
    expect(loads[1]!.signal.aborted).toBe(true);
    loads[1]!.resolve({id: 'detached'} as unknown as Score);
    await flush();
    expect(part.rackPartDeclaration()).toBeUndefined();
  });
  it('does not fetch a standalone declaration without a desk', async () => {
    const part = document.createElement('rack-part');
    part.setAttribute('src', '/unused.mid');
    document.body.append(part);
    await flush();
    expect(loadScoreFromUrl).not.toHaveBeenCalled();
  });
});
