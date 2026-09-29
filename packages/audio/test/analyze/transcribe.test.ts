import {describe, expect, it, vi} from 'vitest';
import {AudioClip, BeatGrid} from '../../src/core';
import {transcribe} from '../../src/analyze/api/transcribe';

vi.mock('@spotify/basic-pitch', () => ({
  BasicPitch: class {
    async evaluateModel(
      _samples: Float32Array,
      onChunk: (frames: number[][], onsets: number[][], contours: number[][]) => void,
    ): Promise<void> {
      onChunk([], [], []);
    }
  },
  outputToNotesPoly: () => [
    {startTimeSeconds: 0.48, endTimeSeconds: 0.87, pitchMidi: 60, amplitude: 0.8},
  ],
  addPitchBendsToNoteEvents: (_contours: unknown, notes: unknown[]) => notes,
  noteFramesToTime: (notes: unknown[]) => notes,
}));
vi.mock('@tensorflow/tfjs', () => ({}));

const samples = new Float32Array(44_100);

function clip(beatGrid?: BeatGrid): AudioClip {
  return new AudioClip({sampleRate: 22_050, channelData: [samples], beatGrid});
}

describe('transcribe beat-grid tempo', () => {
  it('uses an explicitly supplied grid for both quantization and reported BPM', async () => {
    const suppliedGrid = BeatGrid.fromTempo(90, 2);
    const result = await transcribe(clip(BeatGrid.fromTempo(120, 2)), {
      beatGrid: suppliedGrid,
    });

    expect(result.bpm).toBe(90);
    expect(result.notes[0].startSeconds).toBeCloseTo(0.5);
    expect(result.notes[0].endSeconds).toBeCloseTo(5 / 6);
  });

  it('falls back to the clip grid, then to 120 BPM', async () => {
    const withGrid = await transcribe(clip(BeatGrid.fromTempo(100, 2)));
    const withoutGrid = await transcribe(clip());

    expect(withGrid.bpm).toBe(100);
    expect(withoutGrid.bpm).toBe(120);
  });

  it('reports the supplied grid tempo even with quantization disabled', async () => {
    const result = await transcribe(clip(), {
      beatGrid: BeatGrid.fromTempo(75, 2),
      quantize: false,
    });

    expect(result.bpm).toBe(75);
    expect(result.notes[0].startSeconds).toBe(0.48);
  });
});
