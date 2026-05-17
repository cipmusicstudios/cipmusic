# 环境变量清单（不含真实值）

说明每一项 **名称**、**用途**、**允许出现的位置**（浏览器 / Netlify Functions / 仅脚本）。示例一律为 **占位符**。

**通用规则**

- 前缀 **`VITE_`**：由 Vite 注入 **前端 bundle**，**必须视为公开**；不得放 service role、R2 secret、Stripe secret、ZPay key。  
- **Netlify Functions**：运行在服务端，使用 `process.env`；常用 **`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`**（**勿**与 anon 混淆）。  
- **本地**：复制根目录 **`.env.example`** 为 `.env.local`（gitignored）；修改后重启 `npm run dev`。

## 前端（Vite / `import.meta.env`）

| 变量名 | 用途 | 示例（占位） |
|--------|------|----------------|
| `VITE_SUPABASE_URL` | Supabase 项目 URL | `https://YOUR_PROJECT_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | ** anon ** key，浏览器内建客户端 | `eyJ...anon...` |
| `VITE_SUPABASE_SONGS_BUCKET` | 公开音频/封面等 Storage bucket 名 | `songs` |
| `VITE_SONGS_MANIFEST_URL` | 覆盖默认 `/songs-manifest.json` 的完整 URL | `https://cdn.example.com/songs-manifest.json` |
| `VITE_DISTRIBUTION_REGION` | 前端安全发行地区；`global`/未设置时视频优先 YouTube，`mainland_china` 时视频优先 Bilibili | `global` |
| `VITE_AUTH_SIGNUP_URL` | 游客注册外链（可选） | `https://example.com/signup` |
| `VITE_AUTH_LOGIN_URL` | 游客登录外链（可选） | `https://example.com/login` |
| `VITE_AUTHING_APP_ID` | Authing 应用 ID | `YOUR_AUTHING_APP_ID` |
| `VITE_AUTHING_APP_HOST` | Authing 控制台「应用域名」根 URL | `https://YOUR_TENANT.authing.cn` |
| `VITE_AUTHING_REDIRECT_URI` | OIDC 回调，须与控制台一致 | `http://localhost:3001/` |
| `VITE_AUTHING_LANG` | Guard 语言（如 `zh-CN`） | `zh-CN` |
| `VITE_AUTHING_LOGOUT_REDIRECT_URI` | 登出后重定向（可选） | `http://localhost:3001/` |
| `VITE_ZPAY_CREATE_ORDER_URL` | 覆盖默认 `/.netlify/functions/create-zpay-order` | `https://cipmusic.com/.netlify/functions/create-zpay-order` |
| `VITE_READ_MEMBERSHIP_URL` | 覆盖默认 `/.netlify/functions/read-membership` | 同上模式 |
| `VITE_STRIPE_CHECKOUT_MONTHLY_URL` | 本地/dev fallback：Stripe Payment Link | `https://buy.stripe.com/...` |
| `VITE_STRIPE_CHECKOUT_YEARLY_URL` | 同上 | `https://buy.stripe.com/...` |

**说明**：生产环境 Stripe Links **推荐**依赖 `stripe-checkout-links` 从 **服务端 env** 注入（见下），避免旧 VITE 值被 build 永久 bake。

**`vite.config.ts` 额外 define**

| 变量名 | 用途 | 位置 |
|--------|------|------|
| `GEMINI_API_KEY` | 通过 `define` 映射为 `process.env.GEMINI_API_KEY` | 根目录 `.env` / `.env.local`；**勿提交** |

## Netlify Functions（服务端 `process.env`）

### Supabase（Functions 通用）

| 变量名 | 用途 |
|--------|------|
| `SUPABASE_URL` | 与 `VITE_SUPABASE_URL` 通常相同，**服务端读取** |
| `SUPABASE_SERVICE_ROLE_KEY` | ** service role **：Webhook、broker、签名 URL |

### Stripe

| 变量名 | 用途 |
|--------|------|
| `STRIPE_SECRET_KEY` | Stripe SDK 密钥（`stripe-webhook` 等） |
| `STRIPE_WEBHOOK_SECRET` | 校验 webhook 签名 |
| `STRIPE_CHECKOUT_MONTHLY_URL` | Payment Link（`stripe-checkout-links` 优先读取） |
| `STRIPE_CHECKOUT_YEARLY_URL` | 同上 |
| `VITE_STRIPE_CHECKOUT_*_URL` | Functions 内 fallback 名称（与上同名值） |

### ZPay

| 变量名 | 用途 |
|--------|------|
| `ZPAY_PID` | 商户 ID |
| `ZPAY_KEY` | 签名密钥 |
| `ZPAY_GATEWAY` | 下单网关（默认 `https://zpayz.cn/submit.php`） |
| `ZPAY_API_GATEWAY` | MAPI 网关（默认 `https://zpayz.cn/mapi.php`） |
| `ZPAY_NOTIFY_URL` | 异步通知 URL（部署到 `/.netlify/functions/zpay-notify`） |
| `ZPAY_RETURN_URL` | 用户支付后浏览器回跳 |

### Cloudflare R2（付费场景 presign）

| 变量名 | 用途 |
|--------|------|
| `CF_R2_ACCOUNT_ID` | R2 account id |
| `CF_R2_ACCESS_KEY_ID` | S3 兼容 access key |
| `CF_R2_SECRET_ACCESS_KEY` | ** secret ** |
| `CF_R2_BUCKET` | bucket 名 |
| `CF_R2_SCENE_PREFIX` | 对象前缀，默认 `premium-scenes` |
| `CF_R2_SCENE_EXPIRES_SECONDS` | presign TTL（秒），有上界 |

### 练习资源 Storage（Supabase）

| 变量名 | 用途 |
|--------|------|
| `SUPABASE_SONGS_BUCKET` | 默认 `songs`；迁移/兼容用 |
| `SUPABASE_PRACTICE_BUCKET` | 若设置则优先用于 practice 签名桶（如 `practice-assets`） |

## 构建脚本 / 运维脚本（本地 shell / CI）

以下为 **`scripts/*`、manifest、迁移工具** 常用变量（**非完整枚举**；见各脚本文件头注释）。

| 变量名 | 典型用途 |
|--------|----------|
| `MANIFEST_METADATA_ONLY` | `1`：manifest 仅元数据 |
| `MANIFEST_SOURCE` / `MANIFEST_SKIP_DURATION_MERGE` / `MANIFEST_WRITEBACK_LIST_SORT*` | manifest 生成模式 |
| `PRACTICE_MIGRATION_*` / `PRACTICE_DELETE_PUBLIC_*` | 练习资源迁移/清理脚本 |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | 封面/艺人抓取 |
| `BILIBILI_*` | B站视频 override 同步脚本 |
| `DISABLE_HMR` | `vite` HMR 开关（部分环境） |

## 文档 / 示例中出现的非密钥配置

| 变量名 | 用途 |
|--------|------|
| `APP_URL` | `.env.example` 中 AI Studio 场景的自指 URL |

---

**安全自检**：提交 PR 前确保 **无** `.env`、**无** service role、**无** R2/Stripe/ZPay 私钥进入 git。
