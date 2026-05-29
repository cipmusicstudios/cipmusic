-- Google Play Billing（Android 订阅）服务端校验所需表结构。
-- 在 Supabase SQL Editor 中执行；执行前请确认与现有 public schema 无命名冲突。
-- ⚠️ 未经批准请勿在生产库执行（见 docs/handoff/GOOGLE_PLAY_BILLING.md）。
--
-- Netlify Functions 使用 SUPABASE_SERVICE_ROLE_KEY，可绕过 RLS。
-- user_id 对应 Supabase Auth 的 auth.users.id（UUID），与 user_membership / membership_orders 一致。

-- ---------- user_membership：补齐 auto_renew 列（与 Stripe 共用，可能已存在） ----------
-- read-membership 已返回 auto_renew；若库里尚未有该列，verify-google-play-purchase 的 upsert 会失败。
-- 该语句幂等（IF NOT EXISTS），不会影响既有 Stripe/ZPay 数据。
alter table public.user_membership add column if not exists auto_renew boolean;

-- ---------- Google Play 购买记录（幂等键：purchase_token） ----------
create table if not exists public.membership_google_play_purchases (
  purchase_token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  package_name text not null,
  product_id text not null,
  base_plan_id text,
  latest_order_id text,
  subscription_state text,
  expiry_time timestamptz,
  auto_renew boolean,
  acknowledgement_state text,
  linked_purchase_token text,
  raw_response jsonb,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.membership_google_play_purchases is
  'Google Play 订阅服务端校验记录。purchase_token 为幂等主键：重复校验仅 upsert，不重复发放会员。';

create index if not exists idx_gp_purchases_user_id
  on public.membership_google_play_purchases (user_id);
create index if not exists idx_gp_purchases_latest_order_id
  on public.membership_google_play_purchases (latest_order_id);

-- 说明：会员发放仍写入既有 public.user_membership：
--   premium_until = max(现有, Google expiryTime)（绝对时间，天然幂等，不缩短其它渠道有效期）
--   membership_status = 'premium'，payment_provider = 'google_play'。
