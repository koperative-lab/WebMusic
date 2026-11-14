// Structural stand-ins for the Web Audio objects a processor module touches.
// They record connections so tests can assert the managed graph exactly.

export class FakeNode {
  readonly edges: {destination: FakeNode; output: number; input: number}[] = [];
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  disconnected = 0;
  constructor(readonly context: FakeContext, readonly label: string) {}
  connect(destination: FakeNode, output = 0, input = 0): FakeNode {
    this.edges.push({destination, output, input});
    return destination;
  }
  disconnect(destination?: FakeNode): void {
    if (destination) {
      const index = this.edges.findIndex(edge => edge.destination === destination);
      if (index >= 0) this.edges.splice(index, 1);
      return;
    }
    this.disconnected++;
    this.edges.length = 0;
  }
  targets(): FakeNode[] { return this.edges.map(edge => edge.destination); }
}

export class FakeParam {
  readonly writes: {value: number; time: number}[] = [];
  constructor(public value: number, readonly automationRate: 'a-rate' | 'k-rate') {}
  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.writes.push({value, time});
    return this;
  }
}

export class FakeWorkletNode extends FakeNode {
  readonly parameters = new Map<string, FakeParam>();
  readonly posted: unknown[] = [];
  closed = 0;
  onprocessorerror: (() => void) | null = null;
  readonly port = {
    onmessage: null as ((event: {data: unknown}) => void) | null,
    postMessage: (message: unknown) => { this.posted.push(message); },
    close: () => { this.closed++; },
  };
  constructor(context: FakeContext, readonly name: string, readonly options: AudioWorkletNodeOptions,
    params: readonly {id: string; rate: 'a-rate' | 'k-rate'}[]) {
    super(context, 'worklet');
    for (const {id, rate} of params) this.parameters.set(id, new FakeParam(Number(options.parameterData?.[id] ?? 0), rate));
  }
  receive(data: unknown): void { this.port.onmessage?.({data}); }
}

export class FakeContext {
  state = 'suspended';
  sampleRate = 48000;
  currentTime = 1.5;
  readonly destination = new FakeNode(this, 'destination');
  readonly gains: FakeNode[] = [];
  readonly audioWorklet = {addModule: () => Promise.resolve()};
  createGain(): FakeNode {
    const gain = new FakeNode(this, `gain${this.gains.length}`);
    this.gains.push(gain);
    return gain;
  }
}

