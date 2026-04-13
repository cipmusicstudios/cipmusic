import fs from 'fs/promises';
import path from 'path';
import wae from 'web-audio-engine';
import { renderOffline, SplendidGrandPiano } from 'smplr';

globalThis.OfflineAudioContext = wae.OfflineAudioContext;

const cwd = process.cwd();
const samplesDir = path.join(cwd, 'tmp', 'smplr-engine-samples');
const outDir = path.join(cwd, 'public', 'smplr-engine-probes');

const storage = {
  async fetch(url) {
    const filename = decodeURIComponent(url.split('/').pop() || '');
    const filePath = path.join(samplesDir, filename.replaceAll(' ', '_'));
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Missing local sample for ${filename}`);
    }
    const buffer = await fs.readFile(filePath);
    return {
      status: 200,
      async arrayBuffer() {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
      async json() {
        throw new Error('Not JSON');
      },
      async text() {
        return buffer.toString('utf8');
      },
    };
  },
};

const pianoOptions = {
  disableScheduler: true,
  baseUrl: 'https://local-smplr-probes',
  formats: ['wav'],
  storage,
  notesToLoad: {
    notes: [36, 48, 57, 69, 60, 72, 52, 64, 55, 67],
    velocityRange: [85, 100],
  },
};

const renders = [
  {
    name: 'smplr-engine-c3.wav',
    label: 'C3 via smplr.start',
    duration: 2.5,
    events: [{ note: 'C3', time: 0, duration: 1.8, velocity: 88 }],
  },
  {
    name: 'smplr-engine-a4.wav',
    label: 'A4 via smplr.start',
    duration: 2.5,
    events: [{ note: 'A4', time: 0, duration: 1.8, velocity: 88 }],
  },
  {
    name: 'smplr-engine-ceg-chord.wav',
    label: 'C-E-G via smplr.start',
    duration: 3.0,
    events: [
      { note: 'C4', time: 0, duration: 2.2, velocity: 88 },
      { note: 'E4', time: 0, duration: 2.2, velocity: 88 },
      { note: 'G4', time: 0, duration: 2.2, velocity: 88 },
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
