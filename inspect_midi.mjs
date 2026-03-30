import pkg from '@tonejs/midi';
const { Midi } = pkg;

async function analyzeMidi() {
  const url = 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/midi/golden-piano.midi';
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  
  const midi = new Midi(buf);
  
  console.log('MIDI Header:', {
    name: midi.header.name,
    temposCount: midi.header.tempos.length,
    tempos: midi.header.tempos,
    timeSignatures: midi.header.timeSignatures,
  });
  
  console.log(`\nFound ${midi.tracks.length} tracks.`);
  
  midi.tracks.forEach((track, i) => {
    console.log(`\nTrack ${i}:`);
    console.log(`  Name: "${track.name}"`);
    console.log(`  Instrument: ${track.instrument.name} (Family: ${track.instrument.family})`);
    console.log(`  Channel: ${track.channel}`);
    console.log(`  Note Count: ${track.notes.length}`);
    if (track.notes.length > 0) {
      const channels = [...new Set(track.notes.map(n => n.channel))];
      console.log(`  Distinct Channels in Notes: ${channels.join(', ')}`);
      
      // Calculate average pitch to guess hand if needed
      let totalPitch = 0;
      track.notes.forEach(n => totalPitch += n.midi);
      const avgPitch = totalPitch / track.notes.length;
      console.log(`  Average MIDI Pitch: ${avgPitch.toFixed(1)} (Middle C = 60)`);
    }
  });
}

analyzeMidi().catch(console.error);
