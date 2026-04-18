-- 若线上仍残留旧单条 Falling You（manifest 已移除 id 76ac6f51…），执行本段可清掉幽灵行。
-- 与重建脚本二选一：重建脚本已 DELETE 则本句影响 0 行。
DELETE FROM public.songs
WHERE id = '76ac6f51-d656-4ba7-a5cb-d72026e3b573'::uuid;

-- 若刘耀文行 slug 曾被误改（全角括号必须与 locked / 前端一致）：
-- UPDATE public.songs
-- SET slug = 'Falling You（刘耀文）'
-- WHERE title = 'Falling You' AND artist = '刘耀文' AND slug IS DISTINCT FROM 'Falling You（刘耀文）';

-- 都智文/曾可妮版封面（Spotify https://open.spotify.com/track/3yC38fxcJ9z32GihaXr9M4 官方图）
UPDATE public.songs
SET
  cover_url = 'https://i.scdn.co/image/ab67616d0000b273a3677ba94a4ad68ddc6f4563',
  source_cover_url = 'https://i.scdn.co/image/ab67616d0000b273a3677ba94a4ad68ddc6f4563'
WHERE slug = 'Falling You（都智文 曾可妮）';
