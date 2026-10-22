// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Score} from '../../src/core';
const loads = vi.hoisted(() => [] as Array<{signal: AbortSignal; resolve(score: Score): void; reject(error: unknown): void}>);
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: vi.fn((_src: string, {signal}: {signal: AbortSignal}) =>
  new Promise<Score>((resolve, reject) => { loads.push({signal, resolve, reject}); }))}));
import {loadScoreFromUrl} from '../../src/io/load';
import {defineRackPartElement, type RackPartElement} from '../../src/play/element/score-rack-part';
defineRackPartElement();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => { document.body.replaceChildren(); loads.length = 0; vi.clearAllMocks(); });
function mount() {
  const desk = document.createElement('score-rack-control');
  const part = document.createElement('score-rack-part') as RackPartElement;
  part.setAttribute('src', '/first.mid');
  desk.append(part);
  document.body.append(desk);
  return {desk, part};
}

describe('Rack part declaration lifetime', () => {
  it('publishes loading readiness to its desk and ignores a superseded completion', async () => {
    const {part} = mount();
    expect(part.rackPartStatus().kind).toBe('loading');
    await flush();
    const direct = {} as Score;
    part.score = direct;
    expect(loads[0]!.signal.aborted).toBe(true);
    expect(part.rackPartStatus().kind).toBe('ready');
    loads[0]!.resolve({} as Score);
    await flush();
    expect(part.rackPartDeclaration()?.score).toBe(direct);
    expect(part.rackPartStatus().kind).toBe('ready');
    part.removeAttribute('src');
    part.score = undefined;
    expect(part.rackPartStatus().kind).toBe('waiting');
    expect(part.style.display).toBe('none');
  });

  it('clears loading and publishes a failed request to the desk', async () => {
    const {desk, part} = mount();
    const states: string[] = [];
    desk.addEventListener('webscore:rack-part', () => states.push(part.rackPartStatus().kind));
    await flush();
    loads[0]!.reject(new Error('Part unavailable'));
    await flush();
    expect(part.rackPartStatus()).toEqual({kind: 'error', message: 'Part unavailable'});
    expect(states.at(-1)).toBe('error');
    part.removeAttribute('src');
    expect(part.rackPartStatus().kind).toBe('waiting');
  });

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
    const part = document.createElement('score-rack-part');
    part.setAttribute('src', '/unused.mid');
    document.body.append(part);
    await flush();
    expect(loadScoreFromUrl).not.toHaveBeenCalled();
  });
});
