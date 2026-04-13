import fs from 'fs/promises';
import path from 'path';
import wae from 'web-audio-engine';
import { renderOffline, SplendidGrandPiano } from 'smplr';

globalThis.OfflineAudioContext = wae.OfflineAudioContext;

const cwd = process.cwd();
const outDir = path.join(cwd, 'public', 'smplr-probes');

const pianoOptions = {
  disableScheduler: true,
  formats: ['m4a'],
  notesToLoad: {
    notes: [48, 60, 64, 67, 69, 72],
    velocityRange: [1, 127],
  },
};

const renders = [
  {
    name: 'smplr-c3.wav',
    label: 'C3',
    duration: 2.4,
    events: [
      { note: 'C3', time: 0, duration: 1.8, velocity: 88 },
    ],
  },
  {
    name: 'smplr-a4.wav',
    label: 'A4',
    duration: 2.4,
    events: [
      { note: 'A4', time: 0, duration: 1.8, velocity: 88 },
    ],
  },
  {
    name: 'smplr-c5.wav',
    label: 'C5',
    duration: 2.4,
    events: [
      { note: 'C5', time: 0, duration: 1.8, velocity: 88 },
    ],
  },
  {
    name: 'smplr-ceg-chord.wav',
    label: 'C-E-G',
    duration: 3.0,
    events: [
      { note: 'C4', time: 0, duration: 2.2, velocity: 84 },
      { note: 'E4', time: 0, duration: 2.2, velocity: 84 },
      { note: 'G4', time: 0, duration: 2.2, velocity: 84 },
    ],
  },
];

await fs.mkdir(outDir, { recursive: true });

for (const render of renders) {
  const result = await renderOffline(async (context) => {
    const piano = await new SplendidGrandPiano(context, pianoOptions).load;
    for (const event of render.events) {
      piano.start(event);
    }
  }, {
    duration: render.duration,
    sampleRate: 48000,
    channels: 2,
  });

  const wavBlob = result.toWav16();
  const wavBuffer = Buffer.from(await wavBlob.arrayBuffer());
  const outPath = path.join(outDir, render.name);
  await fs.writeFile(outPath, wavBuffer);
  console.log(JSON.stringify({
    label: render.label,
    file: outPath,
    duration: result.duration,
    sampleRate: result.sampleRate,
  }));
}
