# New Song Import Workflow

This workflow is the repeatable path for new uploads placed under `public/local-imports/<song folder>/`.

## Input Files

Each song folder may contain:

- `audio.mp3` required for the song to appear/play
- `performance.mid` optional
- `score.musicxml` optional

Practice Mode is enabled only when all three files exist. If audio exists but MIDI or MusicXML is missing, the song can import, but Practice Mode must stay disabled.

## Metadata File

Create a JSON file like `imports/new-songs.example.json`:

```json
{
  "imports": [
    {
      "folder": "heavy serenade",
      "slug": "heavy serenade",
      "title": "Heavy Serenade",
      "artist": "NMIXX",
      "spotifyUrl": "https://open.spotify.com/track/...",
      "youtubeUrl": "https://www.youtube.com/watch?v=...",
      "bilibiliUrl": "https://www.bilibili.com/video/BV...",
      "sheetUrl": "https://www.mymusic5.com/cipmusic/...",
      "categoryTags": ["韩流流行"]
    }
  ]
}
```

`spotifyUrl` is preserved in local import metadata even though the current Supabase `songs` schema does not have a dedicated `spotify_url` column.

## Commands

Dry-run validation:

```bash
npm run import:songs:dry-run -- --metadata imports/new-songs.json
```

Apply the web import:

```bash
npm run import:songs -- --metadata imports/new-songs.json --apply
```

That command updates metadata overrides, regenerates local import seeds, writes/uploads Supabase rows, skips existing storage objects by default, mirrors practice MIDI/MusicXML to the private broker bucket, rebuilds web manifests, verifies the import, and writes a mobile handoff artifact.

Re-upload exact existing storage targets only when intentionally replacing assets:

```bash
npm run import:songs -- --metadata imports/new-songs.json --apply --overwrite-assets
```

Standalone post-import verification:

```bash
npm run verify:new-song-import -- --metadata imports/new-songs.json
```

The verifier catches:

- imported songs falling below the top of Newest
- missing `list_sort_published_at_ms` / `list_sort_source`
- Chinese web locale not resolving to Bilibili when a Bilibili URL exists
- English web locale not resolving to YouTube when a YouTube URL exists
- public manifest leakage of MIDI/MusicXML fields or paths
- Practice Mode disabled despite complete local audio/MIDI/MusicXML files

## Mobile Handoff

After apply, read:

```text
tmp/new-song-import/mobile-overlay-handoff.json
```

Mobile behavior intentionally differs from web:

- Mainland China build/storefront: default Simplified Chinese and use Bilibili when present.
- International builds: use YouTube even when selected UI language is Simplified or Traditional Chinese.

Do not convert the web UI-language rule into mobile behavior.

## Supabase Schema

This workflow expects the existing `songs` columns:

- `list_sort_published_at_ms`
- `list_sort_source`
- `has_practice_mode`
- `audio_path`, `midi_path`, `xml_path`

No new schema column is required for the automation itself.
