export function midiToFrequency(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const hammerNoiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

function getHammerNoiseBuffer(ctx: AudioContext) {
  const cached = hammerNoiseBuffers.get(ctx);
  if (cached) return cached;

  const length = Math.floor(ctx.sampleRate * 0.03);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const decay = 1 - i / length;
    channel[i] = (Math.random() * 2 - 1) * decay * decay;
  }
  hammerNoiseBuffers.set(ctx, buffer);
  return buffer;
}

export function createPianoLikeVoice(
  ctx: AudioContext,
  frequency: number,
  when: number,
  durationSecs: number,
  velocityScale = 0.18,
) {
  const masterGain = ctx.createGain();
  const highpass = ctx.createBiquadFilter();
  const lowpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(Math.max(28, frequency * 0.42), when);
  lowpass.type = 'lowpass';
  lowpass.Q.value = 1.05;
  lowpass.frequency.setValueAtTime(Math.max(1400, frequency * 11), when);
  lowpass.frequency.exponentialRampToValueAtTime(Math.max(520, frequency * 2.1), when + Math.min(0.32, durationSecs));

  masterGain.gain.setValueAtTime(0.0001, when);
  masterGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocityScale), when + 0.004);
  masterGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocityScale * 0.62), when + 0.045);
  masterGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocityScale * 0.22), when + Math.min(0.22, durationSecs * 0.55));
  masterGain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.16, durationSecs + 0.05));

  highpass.connect(lowpass);
  lowpass.connect(masterGain);
  masterGain.connect(ctx.destination);

  const oscillators = [
    { type: 'triangle' as OscillatorType, ratio: 1, gain: 0.62, detune: -2 },
    { type: 'sine' as OscillatorType, ratio: 1.997, gain: 0.12, detune: 4 },
    { type: 'sine' as OscillatorType, ratio: 2.99, gain: 0.055, detune: -1 },
    { type: 'triangle' as OscillatorType, ratio: 0.5, gain: 0.045, detune: 0 },
  ].map(partial => {
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = partial.type;
    osc.frequency.setValueAtTime(frequency * partial.ratio, when);
    osc.detune.setValueAtTime(partial.detune, when);
    oscGain.gain.setValueAtTime(partial.gain, when);
    oscGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, partial.gain * 0.72), when + 0.08);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.14, durationSecs + 0.04));
    osc.connect(oscGain);
    oscGain.connect(highpass);
    return { osc, gain: oscGain };
  });

  const noise = ctx.createBufferSource();
  noise.buffer = getHammerNoiseBuffer(ctx);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(Math.max(1800, frequency * 5.5), when);
  noiseFilter.Q.value = 0.8;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(Math.max(0.0001, velocityScale * 0.42), when);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.022);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(highpass);

  return { masterGain, highpass, lowpass, noise, noiseFilter, noiseGain, oscillators };
}

export function stopPianoLikeVoice(
  ctx: AudioContext,
  voice: ReturnType<typeof createPianoLikeVoice>,
  when = ctx.currentTime,
) {
  try {
    voice.masterGain.gain.cancelScheduledValues(when);
    voice.masterGain.gain.setValueAtTime(Math.max(voice.masterGain.gain.value, 0.0001), when);
    voice.masterGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  } catch {
    /* ignore */
  }

  try {
    voice.noise.stop(when + 0.05);
  } catch {
    /* ignore */
  }
  voice.oscillators.forEach(({ osc }) => {
    try {
      osc.stop(when + 0.05);
    } catch {
      /* ignore */
    }
  });
}
