/**
 * Cover provenance for LOCAL_IMPORT_OFFICIAL_METADATA (pilot: batch-applied only).
 * Legacy `officialSource` remains for compatibility; prefer `coverSource` for new logic.
 */
export type OfficialCoverSource =
  | 'spotify'
  | 'apple'
  | 'qqMusic'
  | 'youtube_official'
  | 'project_art'
  | 'video_thumbnail'
  | 'placeholder'
  /** legacy / migration */
  | 'appleMusic'
  | 'manual'
  | 'pending'
  | 'retained'
  | 'suppressed';

export type CoverPilotCategory = 'wrong_cover' | 'placeholder' | 'ost_project';
