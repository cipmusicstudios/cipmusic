-- =============================================================================
-- Falling You：删除旧行 + 新建两条（刘耀文 / 都智文·曾可妮）
-- 在 Supabase SQL Editor 中「整段」执行（含 BEGIN/COMMIT）。
--
-- 运行前必做（Storage，bucket 名一般为 songs，与项目一致）：
-- 请将本地两个文件夹中的文件分别上传到下列 **对象路径**（与下方 audio_url 一致）：
--   songs/falling-you-liu-yao-wen/audio.mp3
--   songs/falling-you-liu-yao-wen/performance.mid
--   songs/falling-you-liu-yao-wen/score.musicxml
--   songs/falling-you-du-zeng-keni/audio.mp3
--   songs/falling-you-du-zeng-keni/performance.mid
--   songs/falling-you-du-zeng-keni/score.musicxml
--
-- 若你的项目域名不是 hngtwkayovuxhiqustsa.supabase.co，请在本文件中全文替换为
-- 你的 `https://<project-ref>.supabase.co` 后再执行。
--
-- 不含 bilibili_url 列；B 站链接在 catalog-overrides-locked.ts 的 links.bilibili。
-- 音频 URL 不复用旧行，仅刘耀文封面优先沿用旧行 cover_url（若快照存在）。
--
-- songs.artist 为外键：只能填 artists 表中已存在的键（通常为展示名）。
--   刘耀文版 → '刘耀文'；都智文版 → '都智文'（勿写「都智文、曾可妮」）。
-- 双人展示名由 catalog-overrides-locked「Falling You（都智文 曾可妮）」的 co / artists 负责。
-- =============================================================================

BEGIN;

-- FK：第二条曲目的 songs.artist = '都智文' 要求 artists 中已有该行（你当前库里仅有「刘耀文」）。
INSERT INTO public.artists (name)
SELECT '都智文'
WHERE NOT EXISTS (SELECT 1 FROM public.artists WHERE name = '都智文');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.songs WHERE id = '76ac6f51-d656-4ba7-a5cb-d72026e3b573'::uuid
  ) THEN
    RAISE EXCEPTION '未找到 id=76ac6f51-d656-4ba7-a5cb-d72026e3b573 的旧 Falling You 行；请先在 Table Editor 核对 id 再改脚本。';
  END IF;
END $$;

CREATE TEMP TABLE _fy_old ON COMMIT DROP AS
SELECT * FROM public.songs WHERE id = '76ac6f51-d656-4ba7-a5cb-d72026e3b573'::uuid;

DELETE FROM public.songs WHERE id = '76ac6f51-d656-4ba7-a5cb-d72026e3b573'::uuid;

INSERT INTO public.songs (
  id,
  slug,
  title,
  artist,
  primary_category,
  secondary_category,
  duration,
  audio_url,
  midi_url,
  musicxml_url,
  cover_url,
  youtube_url,
  sheet_url,
  audio_path,
  midi_path,
  xml_path,
  source_song_title,
  source_artist,
  source_cover_url,
  source_album,
  source_release_year,
  source_category,
  source_genre,
  is_published,
  has_practice_mode,
  metadata_status,
  metadata_source,
  metadata_confidence
)
SELECT
  gen_random_uuid(),
  'Falling You（刘耀文）',
  'Falling You',
  '刘耀文',
  '华语流行',
  ARRAY['华语流行']::text[],
  '03:43',
  'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/songs/falling-you-liu-yao-wen/audio.mp3',
  'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/songs/falling-you-liu-yao-wen/performance.mid',
  'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/songs/falling-you-liu-yao-wen/score.musicxml',
  COALESCE(
    (SELECT cover_url FROM _fy_old LIMIT 1),
    'https://i.ytimg.com/vi/De-FuM4-G04/hqdefault.jpg'
  ),
  'https://www.youtube.com/watch?v=De-FuM4-G04',
  'https://mymusic.st/cipmusic/64427',
  'songs/falling-you-liu-yao-wen/audio.mp3',
  'songs/falling-you-liu-yao-wen/performance.mid',
  'songs/falling-you-liu-yao-wen/score.musicxml',
  'Falling You',
  '刘耀文',
  COALESCE(
    (SELECT cover_url FROM _fy_old LIMIT 1),
    'https://i.ytimg.com/vi/De-FuM4-G04/hqdefault.jpg'
  ),
  NULL,
  NULL,
  '华语流行',
  NULL,
  true,
  true,
  'approved',
  'remote',
  1
FROM _fy_old;

INSERT INTO public.songs (
  id,
  slug,
  title,
  artist,
  primary_category,
  secondary_category,
  duration,
  audio_url,
  midi_url,
  musicxml_url,
  cover_url,
  youtube_url,
  sheet_url,
  audio_path,
  midi_path,
  xml_path,
  source_song_title,
  source_artist,
  source_cover_url,
  source_album,
  source_release_year,
  source_category,
  source_genre,
  is_published,
  has_practice_mode,
  metadata_status,
  metadata_source,
  metadata_confidence
) VALUES (
  gen_random_uuid(),
  'Falling You（都智文 曾可妮）',
  'Falling You',
  '都智文',
  '华语流行',
  ARRAY['华语流行', '影视']::text[],
  '03:58',
  'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/songs/falling-you-du-zeng-keni/audio.mp3',
  'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/songs/falling-you-du-zeng-keni/performance.mid',
  'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/songs/falling-you-du-zeng-keni/score.musicxml',
  'https://i.scdn.co/image/ab67616d0000b273a3677ba94a4ad68ddc6f4563',
  'https://www.youtube.com/watch?v=XNcEv7WXb8U',
  'https://mymusic.st/cipmusic/87942',
  'songs/falling-you-du-zeng-keni/audio.mp3',
  'songs/falling-you-du-zeng-keni/performance.mid',
  'songs/falling-you-du-zeng-keni/score.musicxml',
  'Falling You',
  '都智文',
  'https://i.scdn.co/image/ab67616d0000b273a3677ba94a4ad68ddc6f4563',
  NULL,
  NULL,
  '华语流行',
  NULL,
  true,
  true,
  'approved',
  'remote',
  1
);

COMMIT;

-- -----------------------------------------------------------------------------
-- 运行后验证（可单独再跑）
-- -----------------------------------------------------------------------------
-- SELECT id, slug, title, artist, duration, audio_url, youtube_url, sheet_url
-- FROM public.songs
-- WHERE slug IN ('Falling You（刘耀文）', 'Falling You（都智文 曾可妮）')
-- ORDER BY slug;
--
-- SELECT COUNT(*) AS old_row_gone
-- FROM public.songs
-- WHERE id = '76ac6f51-d656-4ba7-a5cb-d72026e3b573'::uuid;
-- -- 期望：0
