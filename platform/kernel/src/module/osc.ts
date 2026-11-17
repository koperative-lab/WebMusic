// ============================================================================
// Open Sound Control (DEC-077): encode and decode OSC 1.0 messages and
// bundles as bytes, for a WebSocket bridge to OSC devices. Pure; the socket
// belongs to the caller.
// ============================================================================

/** An OSC argument: int32 (`i`), float32 (`f`), string (`s`), blob (`b`), true/false (`T`/`F`) or nil (`N`). */
export type OscArgument =
  | {readonly type: 'i'; readonly value: number}
  | {readonly type: 'f'; readonly value: number}
  | {readonly type: 's'; readonly value: string}
  | {readonly type: 'b'; readonly value: Uint8Array}
  | {readonly type: 'T' | 'F' | 'N'};

export interface OscMessage { readonly address: string; readonly args: readonly OscArgument[] }
export interface OscBundle { readonly timetag: bigint; readonly elements: readonly (OscMessage | OscBundle)[] }
export type OscPacket = OscMessage | OscBundle;

export const isOscBundle = (packet: OscPacket): packet is OscBundle => 'elements' in packet;

// Made on first use: evaluating this entry must not need TextEncoder (browser IIFE globals load without one).
let encoder: TextEncoder | undefined;
let decoder: TextDecoder | undefined;
const pad = (length: number) => (length + 3) & ~3;

function stringBytes(value: string): Uint8Array {
  const bytes = (encoder ??= new TextEncoder()).encode(value);
  const out = new Uint8Array(pad(bytes.length + 1));
  out.set(bytes);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Encode a message or bundle. Throws for an address that does not start with `/`. */
export function encodeOsc(packet: OscPacket): Uint8Array {
  if (isOscBundle(packet)) {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setBigUint64(0, packet.timetag);
    const elements = packet.elements.map(element => {
      const bytes = encodeOsc(element);
      const size = new Uint8Array(4);
      new DataView(size.buffer).setInt32(0, bytes.length);
      return concat([size, bytes]);
    });
    return concat([stringBytes('#bundle'), head, ...elements]);
  }
  if (!packet.address.startsWith('/')) throw new SyntaxError(`An OSC address starts with /: ${packet.address}`);
  const parts: Uint8Array[] = [stringBytes(packet.address), stringBytes(`,${packet.args.map(arg => arg.type).join('')}`)];
  for (const arg of packet.args) {
    if (arg.type === 'i' || arg.type === 'f') {
      const bytes = new Uint8Array(4);
      const view = new DataView(bytes.buffer);
      if (arg.type === 'i') view.setInt32(0, arg.value); else view.setFloat32(0, arg.value);
      parts.push(bytes);
    } else if (arg.type === 's') parts.push(stringBytes(arg.value));
    else if (arg.type === 'b') {
      const size = new Uint8Array(4);
      new DataView(size.buffer).setInt32(0, arg.value.length);
      const body = new Uint8Array(pad(arg.value.length));
      body.set(arg.value);
      parts.push(size, body);
    }
  }
  return concat(parts);
}

/** Decode one packet. Throws a SyntaxError for malformed bytes. */
export function decodeOsc(input: ArrayBuffer | Uint8Array): OscPacket {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const need = (count: number) => { if (offset + count > bytes.length) throw new SyntaxError('OSC packet ends early.'); };
  const readString = () => {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    if (end >= bytes.length) throw new SyntaxError('OSC string is not terminated.');
    const value = (decoder ??= new TextDecoder()).decode(bytes.subarray(offset, end));
    offset = pad(end + 1);
    return value;
  };
  const head = readString();
  if (head === '#bundle') {
    need(8);
    const timetag = view.getBigUint64(offset);
    offset += 8;
    const elements: OscPacket[] = [];
    while (offset < bytes.length) {
      need(4);
      const size = view.getInt32(offset);
      offset += 4;
      need(size);
      elements.push(decodeOsc(bytes.subarray(offset, offset + size)));
      offset += size;
    }
    return {timetag, elements};
  }
  if (!head.startsWith('/')) throw new SyntaxError('An OSC packet starts with an address or #bundle.');
  if (offset >= bytes.length) return {address: head, args: []};
  const tags = readString();
  if (!tags.startsWith(',')) throw new SyntaxError('OSC type tags start with a comma.');
  const args: OscArgument[] = [];
  for (const tag of tags.slice(1)) {
    switch (tag) {
      case 'i': need(4); args.push({type: 'i', value: view.getInt32(offset)}); offset += 4; break;
      case 'f': need(4); args.push({type: 'f', value: view.getFloat32(offset)}); offset += 4; break;
      case 's': args.push({type: 's', value: readString()}); break;
      case 'b': { need(4); const size = view.getInt32(offset); offset += 4; need(size); args.push({type: 'b', value: bytes.slice(offset, offset + size)}); offset = pad(offset + size); break; }
      case 'T': case 'F': case 'N': args.push({type: tag}); break;
      default: throw new SyntaxError(`Unsupported OSC type tag ${tag}.`);
    }
  }
  return {address: head, args};
}
