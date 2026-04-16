-- ZPay / 微信一次性会员 + Stripe 国际付（订单记录）所需表结构
-- 在 Supabase SQL Editor 中执行；执行前请确认与现有 public schema 无命名冲突。
-- Netlify Functions 使用 SUPABASE_SERVICE_ROLE_KEY，可绕过 RLS。
-- user_id 对应 Supabase Auth 的 auth.users.id（UUID）。

create table if not exists public.user_membership (
  user_id uuid primary key references auth.users (id) on delete cascade,
  premium_until timestamptz,
  membership_status text,
  payment_provider text,
  last_payment_at timestamptz
);

comment on table public.user_membership is 'Supabase Auth user_id 与会员到期时间；ZPay 回调延长 premium_until。';

create table if not exists public.membership_orders (
  id uuid primary key default gen_random_uuid(),
  out_trade_no text not null unique,
  user_id uuid not null references auth.users (id),
  membership_days integer not null,
  amount_cny numeric(10, 2) not null,
  status text not null default 'pending',
  zpay_trade_no text,
  paid_at timestamptz,
  raw_notify jsonb,
  created_at timestamptz not null default now()
);

comment on table public.membership_orders is 'ZPay 订单：pending → paid；out_trade_no 对接回调。';

create index if not exists idx_membership_orders_user_id on public.membership_orders (user_id);
create index if not exists idx_membership_orders_status on public.membership_orders (status);

-- Netlify 环境变量（示例，勿提交真实密钥）：
-- ZPAY_PID=...
-- ZPAY_KEY=...
-- ZPAY_GATEWAY=https://zpayz.cn/submit.php
-- ZPAY_NOTIFY_URL=https://cipmusic.com/.netlify/functions/zpay-notify
-- ZPAY_RETURN_URL=https://cipmusic.com/settings
-- SUPABASE_URL=...
-- SUPABASE_SERVICE_ROLE_KEY=...
