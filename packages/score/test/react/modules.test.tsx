// @vitest-environment jsdom
import React from 'react';
import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {SessionTransport} from '@webmusic/kernel/session';
import {SOURCE_SCHEMAS, SourcePublisher, type ModuleHandle, type ModulePort} from '@webmusic/kernel/module';
import {useModulePorts, useSessionSnapshot} from '../../src/react';

afterEach(cleanup);

function Position({session}: {session: SessionTransport}) {
  const snapshot = useSessionSnapshot(session);
  return <output data-testid="position">{snapshot?.position ?? 'none'}</output>;
}

function Ports({module}: {module: ModuleHandle}) {
  const ports = useModulePorts(module);
  return <output data-testid="ports">{ports.map((port) => `${port.family}/${port.id}`).join(',')}</output>;
}

describe('React module hooks (DEC-068)', () => {
  it('follows committed Session snapshots', async () => {
    const session = new SessionTransport(() => 0, {driftCheckIntervalMs: 0});
    render(<Position session={session} />);
    expect(screen.getByTestId('position').textContent).toBe('0');
    await act(async () => { await session.seek(2); });
    expect(screen.getByTestId('position').textContent).toBe('2');
    session.dispose();
  });

  it('follows a module port list through its change notifications', () => {
    let ports: readonly ModulePort[] = [];
    const listeners = new Set<() => void>();
    const module: ModuleHandle = {id: 'lead', ports: () => ports,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }};
    render(<Ports module={module} />);
    expect(screen.getByTestId('ports').textContent).toBe('');
    act(() => {
      ports = [new SourcePublisher(SOURCE_SCHEMAS.score)];
      for (const listener of listeners) listener();
    });
    expect(screen.getByTestId('ports').textContent).toBe('source/source');
  });
});
