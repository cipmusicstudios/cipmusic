-- 从 authing_user_id（text）迁移到 user_id（uuid，对齐 Supabase Auth）
-- 在已有 Phase1 表结构的库上执行；执行前请备份。
--
-- 策略说明：
-- 1) 若 authing_user_id 存的是合法 UUID（与当前 Supabase Auth id 一致），可自动回填 user_id。
-- 2) 若历史 id 非 UUID（旧 Authing subject），无法自动映射到 auth.users，对应行需人工处理或放弃（见下方风险）。
-- 3) 新订单与回调只写入 / 读取 user_id；membership_orders 在放宽 authing_user_id 非空后可仅写 user_id（见 Netlify create-zpay-order）。
--
-- 风险（数据不重要时可跳过复杂迁移，改为 DROP +重建 public.user_membership / membership_orders 后重跑 membership-zpay-schema.sql）：
-- - DROP 会丢失历史会员与订单记录；生产环境慎用。

-- ---------- user_membership ----------
alter table public.user_membership add column if not exists user_id uuid;

-- 仅当 authing_user_id 形如 UUID 时回填（PostgreSQL 16+ 可用 uuid 类型校验；此处用正则保守匹配）
update public.user_membership
set user_id = authing_user_id::uuid
where user_id is null
  and authing_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 无法映射的旧行：user_id 仍为 null。可选择删除或手工改派：
-- delete from public.user_membership where user_id is null;

-- zpay-notify upsert(onConflict: user_id) 需要唯一索引；PostgreSQL 允许多行 user_id IS NULL
create unique index if not exists user_membership_user_id_uidx on public.user_membership (user_id);

-- 可选：将主键改为 user_id（要求无 null user_id，且已确认无重复）
-- alter table public.user_membership drop constraint user_membership_pkey;
-- alter table public.user_membership add primary key (user_id);
-- alter table public.user_membership
--   add constraint user_membership_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
-- alter table public.user_membership drop column if exists authing_user_id;

-- ---------- membership_orders ----------
alter table public.membership_orders add column if not exists user_id uuid;

update public.membership_orders
set user_id = authing_user_id::uuid
where user_id is null
  and authing_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

create index if not exists idx_membership_orders_user_id_mig on public.membership_orders (user_id);

-- Netlify create-zpay-order 仅写入 user_id：若 authing_user_id 仍为 NOT NULL，需先放宽或删列。
alter table public.membership_orders alter column authing_user_id drop not null;

-- 新订单应保证 user_id 非空；历史 null 需清理后再执行：
-- alter table public.membership_orders alter column user_id set not null;
-- alter table public.membership_orders
--   add constraint membership_orders_user_id_fkey foreign key (user_id) references auth.users (id);

-- 最终可删除旧列（确认应用与函数不再引用 authing_user_id 后）：
-- alter table public.membership_orders drop column if exists authing_user_id;
