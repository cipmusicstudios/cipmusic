-- Stripe 订阅 webhook 的最小增量字段。
-- 前置：先执行 `supabase/membership-zpay-schema.sql`，确保 public.user_membership 已存在。
-- 本文件只补 Stripe subscription 所需同步字段，不改 UI，不改歌曲数据。

alter table public.user_membership
  add column if not exists auto_renew boolean,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists stripe_price_id text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean,
  add column if not exists last_payment_status text,
  add column if not exists payment_failure_at timestamptz,
  add column if not exists last_webhook_event text,
  add column if not exists last_webhook_at timestamptz;

create index if not exists idx_user_membership_stripe_customer_id
  on public.user_membership (stripe_customer_id);

create index if not exists idx_user_membership_stripe_subscription_id
  on public.user_membership (stripe_subscription_id);

comment on column public.user_membership.auto_renew is
  'Stripe 订阅是否仍会自动续费；通常等于 not cancel_at_period_end 且订阅未结束。';

comment on column public.user_membership.current_period_end is
  'Stripe subscription.current_period_end；通常也同步到 premium_until，供前端会员有效期显示。';

comment on column public.user_membership.last_payment_status is
  '最近一次 Stripe 发票状态摘要：paid / failed / past_due 等。';

comment on column public.user_membership.payment_failure_at is
  '最近一次 invoice.payment_failed 触发时间。';

comment on column public.user_membership.last_webhook_event is
  '最后一次写入该会员行的 Stripe webhook event type。';

comment on column public.user_membership.last_webhook_at is
  '最后一次成功处理并写入该会员行的 Stripe webhook 时间。';
