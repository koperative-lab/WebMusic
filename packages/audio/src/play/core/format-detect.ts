// ============================================================================
// Container-format sniffing from leading magic bytes. Split from load.ts so
// that decode.ts can consume detection without importing the loader (which
// itself imports decode.ts) — keeping the module graph cycle-free.
// ============================================================================

import {type AudioFormat} from '../../core';

/** Infer a format from a URL or path file extension, if recognizable. */
export function formatFromExtension(url: string): AudioFormat | undefined {
  const path = url.split(/[?#]/, 1)[0] ?? url;
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'wav':
    case 'wave':
      return 'wav';
    case 'aif':
    case 'aiff':
    case 'aifc':
      return 'aiff';
    case 'mp3':
      return 'mp3';
    case 'flac':
      return 'flac';
    case 'ogg':
    case 'oga':
      return 'ogg';
    case 'opus':
      return 'opus';
    case 'm4a':
    case 'mp4':
    case 'm4b':
      return 'm4a';
    case 'aac':
      return 'aac';
    case 'weba':
    case 'webm':
      return 'webm';
    default:
      return undefined;
  }
}

/**
 * Sniff a container format from a buffer's leading magic bytes. Returns
 * `undefined` when nothing recognizable matches (caller may fall back to the
 * extension or an explicit hint).
 */
export function detectAudioFormat(buffer: ArrayBuffer): AudioFormat | undefined {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) return undefined;

  // RIFF....WAVE — WAV
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
      return 'wav';
    }
    return 'wav';
  }
  // FORM....AIFF / AIFC — AIFF
  if (bytes[0] === 0x46 && bytes[1] === 0x4f && bytes[2] === 0x52 && bytes[3] === 0x4d) {
    if (bytes.length >= 12 && bytes[8] === 0x41 && bytes[9] === 0x49 && bytes[10] === 0x46) return 'aiff';
  }
  // "fLaC" — FLAC
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'flac';
  // "OggS" — Ogg container (Vorbis or Opus); peek the codec id inside.
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return sniffOgg(bytes);
  }
  // "ID3" — MP3 with an ID3v2 tag
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'mp3';
  // 0xFFF0 / 0xFFF1 / 0xFFF8 / 0xFFF9 — raw ADTS AAC (sync word with the layer
  // bits zero). Must precede the generic MPEG sync below: the ADTS sync word
  // also satisfies the MPEG-1/2 frame-sync mask (0xF1 & 0xE0 === 0xE0), so the
  // broader test would otherwise claim these bytes as MP3 and leave AAC dead.
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'aac';
  // 0xFF 0xFB / 0xF3 / 0xF2 / 0xFA — raw MPEG-1/2 audio frame sync (MP3)
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  // "....ftyp" — ISO-BMFF (m4a / aac in mp4)
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return sniffFtyp(bytes);
  }
  // 0x1A45DFA3 — EBML (WebM / Matroska)
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  return undefined;
}

/** Within an Ogg container, "OpusHead" near the start ⇒ opus, else vorbis. */
function sniffOgg(bytes: Uint8Array): AudioFormat {
  const window = bytes.subarray(0, Math.min(bytes.length, 64));
  const text = String.fromCharCode(...window);
  if (text.includes('OpusHead')) return 'opus';
  return 'ogg';
}

/** Within an ISO-BMFF `ftyp`, distinguish AAC-in-mp4 brands from generic m4a. */
function sniffFtyp(bytes: Uint8Array): AudioFormat {
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (brand === 'M4A ' || brand === 'mp42' || brand === 'isom' || brand === 'M4B ') return 'm4a';
  return 'm4a';
}
