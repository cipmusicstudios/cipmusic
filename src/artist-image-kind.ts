/**
 * Role of the image asset for a canonical artist bucket.
 * Used in artist-manifest + overrides + cache for maintenance and optional UI.
 */
export type ArtistImageKind =
  | 'artist_photo'
  | 'group_photo'
  | 'project_logo'
  | 'key_art'
  | 'fallback_avatar';
