// The spectral reference processor's worklet file.
import {defineProcessor} from '@webmusic/kernel/processor-worklet';
import {spectralGate} from './spectral-gate';
import {spectralGateDsp} from './spectral-gate-dsp';

defineProcessor(spectralGate, spectralGateDsp);
