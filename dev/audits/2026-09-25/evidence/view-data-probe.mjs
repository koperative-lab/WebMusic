import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const scratch=mkdtempSync(join(tmpdir(),'webmusic-view-'));
const output=join(scratch,'probe.mjs');
const root=process.argv[2] ?? process.cwd();
const {build}=await import(root+'/node_modules/esbuild/lib/main.js');
await build({stdin:{contents:`export {parseWav} from '${root}/packages/audio/src/play/core/wav.ts'; export {AudioClip} from '${root}/packages/audio/src/core/model/AudioClip.ts'; export {computeClipPeaks,peaksDuration} from '${root}/packages/audio/src/view/headless/peaks.ts'; export {computeSpectrogram} from '${root}/packages/audio/src/analyze/core/spectrogram.ts'; export {createAudioTimeline} from '${root}/packages/audio/src/view/headless/timeline.ts'; export {createSpectrogramViewModel} from '${root}/packages/audio/src/view/headless/spectrogram.ts';`,resolveDir:root},bundle:true,format:'esm',platform:'node',outfile:output,logLevel:'silent'});
const {parseWav,AudioClip,computeClipPeaks,peaksDuration,computeSpectrogram,createAudioTimeline,createSpectrogramViewModel}=await import(pathToFileURL(output).href);
const timed=(label,fn)=>{const start=performance.now(); const value=fn(); console.log(label,Math.round(performance.now()-start)+'ms'); return value;};
const bytes=readFileSync(root+'/apps/doc/webmusic/public/demo.wav');
const wave=timed('parseWav',()=>parseWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
console.log('wav',Object.keys(wave));
const clip=timed('AudioClip',()=>new AudioClip({sampleRate:wave.sampleRate,channelData:wave.channelData}));
console.log('clip',{sampleRate:clip.sampleRate,channels:clip.numberOfChannels,seconds:clip.duration,PCMBytes:clip.length*clip.numberOfChannels*4});
const peaks=timed('computeClipPeaks',()=>computeClipPeaks(clip));
console.log('peaksBytes',peaks.levels.reduce((n,l)=>n+l.data.byteLength,0));
const ch=timed('channelData',()=>clip.channelData(0));
for(let i=0;i<2;i++) { const spec=timed('spectrogram'+i,()=>computeSpectrogram(ch,clip.sampleRate,{fftSize:1024,hopSize:256})); console.log('spec',{frames:spec.times.length,magBytes:spec.magnitudes.byteLength}); }
console.log('emptyClipDuration',peaksDuration(computeClipPeaks(new AudioClip({sampleRate:48000,channelData:[new Float32Array(0)]}))));
const spec=createSpectrogramViewModel({times:[0,.5,1],frequencies:[0,100],binsPerFrame:2,magnitudes:new Float32Array(6)},{pixelsPerSecond:100,viewportWidth:10,offsetPixels:20,durationSeconds:1.5});
console.log('betweenFrames',spec.timeline.visibleRange(),spec.frames());
const timeline=createAudioTimeline({durationSeconds:10,pixelsPerSecond:100,viewportWidth:100});timeline.setZoom(200,NaN);console.log('nanAnchor',timeline.snapshot);

rmSync(scratch,{recursive:true,force:true});
