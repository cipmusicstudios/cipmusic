/**
 * Resolve Supabase Storage object paths to public URLs (same rules as `scripts/build-songs-manifest.ts` → `toPublicStorageUrl`).
 * If the value is already `http(s)://`, it is returned unchanged.
 */
export function toSupabaseStoragePublicUrl(
  supabaseUrl: string | undefined,
  bucket: string,
  pathOrUrl: string | null | undefined,
): string {
  if (pathOrUrl == null || typeof pathOrUrl !== 'string') return '';
  const v = pathOrUrl.trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (!supabaseUrl?.trim()) return v;
  const cleanBase = supabaseUrl.replace(/\/+$/, '');
  const cleanBucket = bucket.replace(/^\/+|\/+$/g, '');
  const cleanPath = v.replace(/^\/+/, '');
  return `${cleanBase}/storage/v1/object/public/${cleanBucket}/${cleanPath}`;
}
