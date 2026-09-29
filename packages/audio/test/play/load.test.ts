import {describe, expect, it} from 'vitest';
import {detectAudioFormat, formatFromExtension} from '../../src/play/api/load';

/** Build an ArrayBuffer from a list of byte values (zero-padded to `length`). */
function bytes(values: number[], length = values.length): ArrayBuffer {
  const arr = new Uint8Array(length);
  arr.set(values);
  return arr.buffer;
}

/** Write ASCII at an offset into a byte list builder. */
function withAscii(base: number[], offset: number, text: string): number[] {
  const out = base.slice();
  for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  return out;
}

describe('detectAudioFormat — magic bytes', () => {
  it('returns undefined for buffers shorter than 4 bytes', () => {
    expect(detectAudioFormat(new ArrayBuffer(0))).toBeUndefined();
    expect(detectAudioFormat(new ArrayBuffer(3))).toBeUndefined();
  });

  it('detects WAV from RIFF....WAVE', () => {
    // "RIFF" + 4 size bytes + "WAVE"
    let b = withAscii(new Array(12).fill(0), 0, 'RIFF');
    b = withAscii(b, 8, 'WAVE');
    expect(detectAudioFormat(bytes(b))).toBe('wav');
  });

  it('detects AIFF from FORM....AIFF', () => {
    let b = withAscii(new Array(12).fill(0), 0, 'FORM');
    b = withAscii(b, 8, 'AIFF');
    expect(detectAudioFormat(bytes(b))).toBe('aiff');
  });

  it('detects FLAC from the "fLaC" stream marker', () => {
    expect(detectAudioFormat(bytes(withAscii(new Array(8).fill(0), 0, 'fLaC')))).toBe('flac');
  });

  it('detects Ogg Vorbis from "OggS" without an Opus header', () => {
    const b = withAscii(new Array(64).fill(0), 0, 'OggS');
    expect(detectAudioFormat(bytes(b))).toBe('ogg');
  });

  it('detects Opus when "OpusHead" appears inside an Ogg page', () => {
    let b = withAscii(new Array(64).fill(0), 0, 'OggS');
    b = withAscii(b, 28, 'OpusHead');
    expect(detectAudioFormat(bytes(b))).toBe('opus');
  });

  it('detects MP3 from an ID3v2 tag', () => {
    expect(detectAudioFormat(bytes(withAscii(new Array(8).fill(0), 0, 'ID3')))).toBe('mp3');
  });

  it('detects MP3 from a raw MPEG frame sync (0xFFFB)', () => {
    expect(detectAudioFormat(bytes([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3');
  });

  it('detects m4a from an ISO-BMFF ftyp box', () => {
    let b = withAscii(new Array(16).fill(0), 4, 'ftyp');
    b = withAscii(b, 8, 'M4A ');
    expect(detectAudioFormat(bytes(b))).toBe('m4a');
  });

  it('detects WebM/Matroska from the EBML magic', () => {
    expect(detectAudioFormat(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm');
  });

  it('detects AAC carried in an ISO-BMFF ftyp box', () => {
    let b = withAscii(new Array(16).fill(0), 4, 'ftyp');
    b = withAscii(b, 8, 'M4A ');
    // AAC normally ships inside an mp4/m4a container, which sniffs as m4a.
    expect(detectAudioFormat(bytes(b))).toBe('m4a');
  });

  it('detects raw ADTS AAC from its 0xFFF1 sync word', () => {
    // The ADTS sync word (0xFFF0/0xFFF1/0xFFF8/0xFFF9, layer bits zero) is
    // checked before the broader MPEG-1/2 frame-sync mask, so a bare ADTS
    // header is correctly reported as aac rather than mp3.
    expect(detectAudioFormat(bytes([0xff, 0xf1, 0x00, 0x00]))).toBe('aac');
  });

  it('returns undefined for unrecognized leading bytes', () => {
    expect(detectAudioFormat(bytes([0x00, 0x01, 0x02, 0x03]))).toBeUndefined();
  });
});

describe('formatFromExtension', () => {
  it.each([
    ['song.wav', 'wav'],
    ['song.WAVE', 'wav'],
    ['clip.aiff', 'aiff'],
    ['take.aif', 'aiff'],
    ['track.mp3', 'mp3'],
    ['music.flac', 'flac'],
    ['loop.ogg', 'ogg'],
    ['loop.oga', 'ogg'],
    ['voice.opus', 'opus'],
    ['podcast.m4a', 'm4a'],
    ['movie.mp4', 'm4a'],
    ['stream.aac', 'aac'],
    ['rec.webm', 'webm'],
    ['rec.weba', 'webm'],
  ])('maps %s → %s', (url, expected) => {
    expect(formatFromExtension(url)).toBe(expected);
  });

  it('ignores query strings and fragments', () => {
    expect(formatFromExtension('https://cdn.example.com/a/b/song.mp3?token=xyz#t=30')).toBe('mp3');
  });

  it('is case-insensitive on the extension', () => {
    expect(formatFromExtension('SONG.MP3')).toBe('mp3');
  });

  it('returns undefined for unknown or missing extensions', () => {
    expect(formatFromExtension('README')).toBeUndefined();
    expect(formatFromExtension('archive.zip')).toBeUndefined();
  });
});
