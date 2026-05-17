# CIP Music / AuraSounds — Web 交接主文档

面向对象：**接手本仓库 Web 的编程 Agent（如 Codex）**。  
仓库路径（本机）：`钢琴app项目/projects/aurasounds-main-deploy`。**不包含密钥或 token。**

## 1. 产品与项目概览

- **品牌与定位**：面向 CIP Music 编配内容的沉浸式听音 / 学习体验；代码与文案中常出现 **AuraSounds** 与 **CIP Music**。
- **Web 应用职责**：曲库浏览与路由、音频播放、背景场景视频、氛围音效（Ambient）、**练习模式（OSMD 谱面 + MIDI）**、会员与支付（Stripe / ZPay）、**Smart Radio** 自动续播、与 Supabase 同步的收藏/最近播放（需库内已应用对应 migration）。

## 2. 技术栈（仓库内实际存在）

| 层级 | 技术 |
|------|------|
| 前端框架 | **React 19** + **TypeScript** |
| 构建 | **Vite 6**、`@vitejs/plugin-react`、`@tailwindcss/vite`、**Tailwind 4** |
| 数据 / Auth | **Supabase**（`@supabase/supabase-js`），另有可选 **Authing Guard**（`@authing/guard`）配置 |
| 托管 / SSR-less API | **Netlify**（`netlify.toml` + `netlify/functions/*`） |
| 对象存储 | **Supabase Storage**（公开音频/封面等）；**Cloudflare R2**（付费场景视频，经服务端 presign） |
| 乐谱 | **opensheetmusicdisplay**（OSMD） |
| MIDI | **`@tonejs/midi`** 解析；练习内 **Tone.js**、 **`smplr`** 等 |
| 支付 | **Stripe**（订阅/Webhook、Payment Links）；**ZPay**（微信等，一次性） |
| 其他 | **`react-window`**（长列表）、**`motion`**、**`web-audio-engine`** / **`standardized-audio-context`**（音频相关） |

## 3. Web 架构（目录级）

- **`src/App.tsx`**：根布局、路由状态、**HTMLAudioElement 播放器**、背景 **Scene**（免费公开 URL vs broker 的付费 R2）、**Smart Radio** 与尾声 crossfade、**Ambient** 全局混音、会员 gating、与 `MusicTab` / Player 子组件协作。
- **`src/MusicTab.tsx`**：曲库 UI、分类/艺人桶、列表性能（注释强调避免重 backdrop-filter）。
- **`src/songs-manifest.ts` + `public/songs-manifest.json`**：离线 manifest 管线；运行时默认加载 manifest（`VITE_SONGS_MANIFEST_URL` 可覆写）。
- **`scripts/build-songs-manifest.ts`**：构建时生成/更新 manifest；可选写回 Supabase sort 字段（`MANIFEST_WRITEBACK_LIST_SORT`）。
- **`src/practice/PracticePanelModule.tsx`**：**练习模式核心**（OSMD 实例、MIDI 时间轴、左手/右手、速度、节拍器、AB loop、谱面高亮与键盘高亮、`practiceTransport`）。
- **`src/musicxml-hand-utils.ts`**：从 MusicXML / OSMD 与 MIDI 对齐双手等逻辑。
- **`src/lib/practice-asset-url.ts`**：前端 **唯一应使用** 的练习资源入口；请求 **`/.netlify/functions/practice-asset-url`**，带 Supabase **用户** JWT，拿到 **短效签名 URL**。
- **`src/lib/scene-asset-url.ts`**：付费场景请求 **`/.netlify/functions/scene-asset-url`**；本地内存缓存 presigned URL。
- **`src/lib/membership-remote.ts`**：请求 **`/.netlify/functions/read-membership`**。
- **`src/smart-radio-pick.ts`**：Smart Radio 下一首挑选算法。
- **`src/track-display.ts`** / **`src/video-overrides.ts`**：外链视频、简中 B 站 override 等。
- **`src/index.css` + `src/premium-ui.ts`**：全局样式；含大量 `backdrop-filter` 变体——**新增密集列表/动画层需谨慎**。
- **静态资源**：`public/ambience/*.mp3`（环境音），`public/salamander/`（练习钢琴采样，`PracticePanelModule` 内 `PRACTICE_TONE_SAMPLER_BASE_URL`）。

## 4. Practice Mode 架构（Canonical = Web 本实现）

**若未来移动端（Expo）移植，以以下 Web 文件为行为标准：**

1. **`src/practice/PracticePanelModule.tsx`**
2. **`src/musicxml-hand-utils.ts`**
3. **`src/lib/practice-asset-url.ts`**（资源 **必须** 经 broker，禁止把私密 object 永久 URL 硬编码进 App bundle）

### 4.1 资源获取

- DB `songs` 行通过 **`has_practice_mode`**（及 manifest 的 practice 标志）驱动 UI 是否可进练习。
- Anon `SELECT` **故意不包含** `midi_url` / `musicxml_url`（见 `App.tsx` 内注释）；打开练习时 **`resolvePracticeAssetUrl(trackId)`** 调用 Netlify Function，用 **service role** 在服务端签名 **Supabase Storage**（或迁移后的 private bucket，见函数内 `SUPABASE_PRACTICE_BUCKET` 注释）。

### 4.2 OSMD + MusicXML + MIDI

- **OSMD** 渲染 MusicXML；自 **`@tonejs/midi`** 解析 MIDI，建立 tick/时间映射。
- **小节与时间**：`practiceMeasureTimelineRef`、从 OSMD `SourceMeasures` / `GraphicSheet.MeasureList` 推导；**`leadInMeasures`** 由 **`getLeadInMeasuresFromFirstNoteTick`**（基于 **第一个 MIDI note 的 tick** 与拍号）计算——**非硬编码「第一小节全休止」**。
- **`getMeasureStartTime(displayMeasureIndex)`** 使用 `(displayMeasureIndex + leadInMeasures) * beatsPerMeasure * ppq` 与 tempo map 换算为秒。
- **双手**：`assignSingleTrackMidiHandsFromMusicXml`；若无法可靠分轨会退化到 **`dual-track`** / **`both-only`** 等模式（见 `PracticePanelModule` 内 `handMode` 分支）。

### 4.3 播放与高亮

- 主播放器音频仍由 App 层 `HTMLAudioElement` 提供；练习模式有 **`practiceTransport`**（`requestAnimationFrame` 驱动），与 **MIDI 调度**、**谱面 cursor**、**虚拟键盘**同步。
- **速度**：`playbackRate` / transport 层与 UI `speeds` 数组联动（见 App 与 practice 模块交叉引用）。
- **节拍器**：Web Audio 调度；`metronomeOn` / `metronomeVol`。
- **AB loop**：`loopM1`/`loopM2`（display measure index）；靠 `getMeasureStartTime` 与硬截断窗口 `PRACTICE_LOOP_HARD_CUT_SECS` 循环回绕。

### 4.4 「Canonical behavior」注意

- **不要随意改**：首小节 lead-in、rest 处理、transport 与 `playbackTimelineTime` 的握手、loop 建立后 **立即 seek 到 M1** 的逻辑——这些是用户体感「对拍」核心。
- **`lightweightMode`**：部分 overlay 减少 `backdrop-blur`，与性能相关。

## 5. Player 架构与已知「加载 / 元数据」问题

- **主播放器**：`HTMLAudioElement`（`audioRef`），时间轴 state + `PlayerProgressStrip`。
- **Smart Radio**：尾声 ~8s 预缓冲下一首；最后 ~2s **只淡出当前曲**，下一首 handoff 后从 0s **满音量**（见 `App.tsx` 内注释与 `crossfade*` refs）。
- **Hydration / 时长 0:00**：`App.tsx` 中明确注释：浏览器缓存可能导致 **`onLoadedMetadata` 不触发**；已有 `useEffect` 在 `currentTrack.audioUrl` 变化时若 `readyState >= 1` 则直接读 `duration`。  
  **回归**：切歌后进度条时长应显示正确。

## 6. 会员 / Premium gating

- **前端判定**：读取 **`read-membership`**；`membership-remote.remotePremiumEntitled` 等工具函数。
- **后端真源**：`user_membership`（及 Stripe webhook / ZPay notify 写入）。**永远不要**在前端信任客户端本地「已是会员」而跳过服务器校验（尤其 broker/scene）。
- **能力示例**：Smart Radio、多轨 Ambient preset、付费 **brokered** 场景（Forest / Celestial）、练习可能受登录/会员策略影响（以当前 `App.tsx` / `PracticePanelModule` 为准）。

## 7. Stripe / ZPay（代码位置，无密钥）

| 区域 | 路径 |
|------|------|
| Stripe Payment Links（请求时注入 URL） | `netlify/functions/stripe-checkout-links.ts` |
| Stripe Webhook | `netlify/functions/stripe-webhook.ts` |
| ZPay 下单 | `netlify/functions/create-zpay-order.ts` |
| ZPay 异步通知 | `netlify/functions/zpay-notify.ts` |
| 前端 Stripe checkout 封装 | `src/checkout-links.ts`、`src/membership-checkout-modal.tsx` |
| ZPay 前端入口 | `src/lib/zpay-order.ts` |

## 8. 场景 / 背景视频

- **Scene 定义**：`App.tsx` 内 `SCENES`。
- **免费场景**：可直接使用 **公开** mp4 URL（代码中可见 `*.r2.dev` **公共**链接示例——非私有凭据）。
- **付费场景**：`brokered: true` → **`scene-asset-url`**：校验 JWT + **`user_membership`**，再对 **Cloudflare R2** 生成 **presigned GET**（对象 key 由服务端映射，`CF_R2_SCENE_PREFIX` 默认 `premium-scenes`，文件名如 `forest.mp4`、`starry.mp4` 及 `portrait/` 下对应文件）。
- **性能**：全屏循环 `<video>`；注意与 **blur 层叠**、移动端竖屏 portrait 资产切换的逻辑。

## 9. Ambient（氛围音）

- **`App.tsx`**：多路 `<audio>` 管理、`AMBIENCE_AUDIO_URLS` 指向 `/ambience/...`、音量淡入淡出、与 premium preset 联动（非会员限制路数，见代码）。

## 10. Smart Radio

- **开关 UI / Toast**：`App.tsx`。
- **选曲逻辑**：`src/smart-radio-pick.ts`（艺人、类别、work project、氛围等加权；避免近期重复）。
- **续播触发**：播放中且 premium + `smartRadioActive`，临近结束 pre-buffer 与 track switch（与 `getNextSmartRadioTrack` 回调配合）。

## 11. 曲库数据流：Manifest ↔ Supabase

- **本地 / SEO / CDN**：`public/songs-manifest.json`（`npm run build` 前 `prebuild` 会 `MANIFEST_METADATA_ONLY=1` 跑 manifest 脚本）。
- **远端增量**：`App.tsx` 内 `supabase.from('songs').select(SUPABASE_REMOTE_SONG_COLUMNS)` 拉取 **必要时** 的行并入内存索引 **不**把 `midi_url`/`musicxml_url` 暴露给 anon。
- **路由**：艺人、分类、project IP 等多维桶；`MusicTab` + manifest 内 `metadata.display`、`workProjectKey`、`canonicalArtistId` 等字段。
- **外链**：YouTube/Bilibili/sheet URL 经 manifest / DB，`track-display.ts` 校验「真实 watch URL」vs 搜索页/频道页。

### 11.1 视频外链：发行地区配置（重要）

- **当前代码**（如 `App.tsx`「看视频」按钮）：通过前端安全变量 **`VITE_DISTRIBUTION_REGION`** 决定 provider 优先级，**不再**使用 `currentLang`。
- **规则（Cece / 业务）**：未设置或 `global` 时 **YouTube 优先**、Bilibili fallback；`mainland_china` 时 **Bilibili 优先**、YouTube fallback。语言只控制 UI 文案。
- **注意**：`mainland_china` 的最终发行/地区判定仍需运维在构建环境中明确配置。

## 12. 性能注意事项

- **背景视频 + 大模糊**：全屏 video 与 `backdrop-filter` / `backdrop-blur-*` 叠层会导致 GPU 压力；`MusicTab` 等已改用 **静态半透明**。
- **OSMD**：重排/重缩放成本大；避免在 resize 时无谓重建。
- **长列表**：`react-window`；注意 manifest 合并后列表长度。
- **图片**：封面 URL 经 Supabase public storage；注意解码与 list virtualization。
- **缓存**：`scene-asset-url` / `practice-asset-url` 客户端有 **内存 TTL 缓存**；调时注意安全窗口（到期前刷新）。

## 13. Supabase：表与 Storage（应用相关）

### 13.1 表（代码中直接引用或 schema 脚本）

- **`public.songs`**：曲库；与 manifest 合并。迁移可含 `list_sort_published_at_ms`、`list_sort_source`（见移动端仓库 `supabase/migrations` 说明，库为 **Web/Mobile 共用**）。
- **`public.user_membership`**、**`public.membership_orders`**：会员与 ZPay 订单（`supabase/membership-zpay-schema.sql`）。
- **`public.user_favorites`**、**`public.user_recently_played`**：`src/lib/user-library-remote.ts`（需 RLS migration）。
- **`auth.users`**：Supabase Auth 用户；所有 `user_id` FK 指向此。

### 13.2 Storage Buckets

- **`songs`**（默认名，可用 `VITE_SUPABASE_SONGS_BUCKET` / `SUPABASE_SONGS_BUCKET` 覆盖）：**公开**音频、封面等路径；历史上有练习 MIDI/XML；**进行中/已完成**向 **`practice-assets`**（私有 + broker）迁移的脚本见 `scripts/prepare-practice-assets-migration.ts` 等。
- **`practice-assets`**（可选，`SUPABASE_PRACTICE_BUCKET`）：**私有**练习资源目标桶（`practice-asset-url.ts` 内 Phase 注释）。

## 14. Netlify Functions 一览

| 函数 | 作用 |
|------|------|
| `read-membership` | 校验 `Authorization: Bearer <supabase access token>`，读 `user_membership`，返回 **收紧后的** UI 字段 |
| `practice-asset-url` | 同上鉴权；读 `songs` 表 MIDI/XML 路径；返回 **短效签名 URL** |
| `scene-asset-url` | 鉴权 + premium；对 R2 **presign** 付费场景 mp4 |
| `stripe-checkout-links` | 返回 Stripe Payment Link URLs（读 Netlify 环境变量，避免旧 VITE 值写死） |
| `stripe-webhook` | Stripe 事件 → 更新 `user_membership` |
| `create-zpay-order` | 创建 ZPay 订单（需 `ZPAY_*`、Supabase service） |
| `zpay-notify` | ZPay 支付回调 → 更新订单与会员 |
| `_shared/*` | Supabase service client、R2 presign、用户 id 工具、ZPay 签名 |

## 15. 部署

- **Netlify**：`netlify.toml` — `npm run build`，发布 `dist/`；SPA `/*` fallback 到 `index.html`；functions 目录 `netlify/functions`。
- **生产站点**：公开文档与静态页出现 **`https://cipmusic.com`**（以实际 DNS 为准）；**无** Netlify 临时域名写死在代码核心路径。
- **环境变量**：见 `ENVIRONMENT.md`（服务器必须用 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`，**不能**依赖 `VITE_*` 注入 Functions）。

## 16. 当前 Git 状态（记录时刻；接手后请重跑）

> **注意**：以下为本交接文档生成时 **单次采样的输出**；你 **必须** 在动手前自己执行 `git status`。

| 项 | 值 |
|----|-----|
| 分支 | `deploy-main-webhook` |
| HEAD | `516d62be7a61f91cfc73d29c97b181fc7de94470` |
| 远端 | 曾显示 **落后 `origin/main` 6 commits**（可 fast-forward） |
| 工作区 | **clean**（无未提交修改） |

### 近期变更文件（约最近 15 个提交内）

`netlify/functions/scene-asset-url.ts`、`package.json`、`public/about.html`、`public/privacy.html`、`public/terms.html`、`scripts/build-songs-manifest.ts`、`scripts/prepare-delete-public-practice-assets.ts`、`scripts/prepare-practice-assets-migration.ts`、`scripts/writeback-list-sort.ts`、`src/App.tsx`、`src/MusicTab.tsx`、`src/auth/supabase-auth-modal.tsx`、`src/auth/supabase-reset-password-gate.tsx`、`src/index.css`、`src/lib/guest-play-limit.ts`、`src/lib/scene-asset-url.ts`、`src/lib/user-library-migration.ts`、`src/lib/user-library-remote.ts`、`src/locales/en.ts`、`src/locales/zh-cn.ts`、`src/locales/zh-tw.ts`、`src/musicxml-hand-utils.ts`、`src/practice/PracticePanelModule.header.tsx`、`src/practice/PracticePanelModule.tsx`

## 17. Web 测试检查清单（手测）

- [ ] `npm run dev` 能打开；无 Supabase env 时错误提示符合预期  
- [ ] Manifest +（若配置）远端 `songs` 合并后列表可浏览  
- [ ] 选歌播放：进度与 **总时长** 正确（含「缓存不触发 metadata」场景）  
- [ ] Smart Radio（会员）：开关有效，尾声 auto-next 无明显爆音/断音  
- [ ] Ambient：多路混音、会员路数限制、切页后仍连续（全局引擎）  
- [ ] 场景：免费场景播放；付费场景仅会员且 broker 失败时有体面降级  
- [ ] **练习模式**：进/出、OSMD Renderable、MIDI 音、速度、节拍器、AB loop、双手 filter  
- [ ] 登录后 `read-membership` 可达（生产或 `netlify dev`）；失败时 UI 降级可接受  
- [ ] Stripe / ZPay：仅沙箱或生产账号下测支付流；**勿**在日志中打印密钥  
- [ ] 外链：视频/谱面「新开标签」行为符合 **当前** 逻辑，并对照产品规则评估 gap  

## 18. 「Do not break」规则（汇总）

1. **勿**在前端 bundle 暴露 **私有** Supabase / R2 资产直达 URL（应继续走 broker / 公开 CDN 边界）。
2. **勿**把 **`SUPABASE_SERVICE_ROLE_KEY`** 或等价高权限密钥送入浏览器。
3. **勿**减弱 **RLS** 或把「仅服务端可读」的练习资源对 anon 公开 SELECT。
4. **勿**在未记录影响的情况下修改 **支付 / 订阅 / 会员 / 安全** 逻辑。
5. **视频策略**：非中国大陆发行应优先 **YouTube**；仅中国大陆发行/地区模式默认简中且优先 **Bilibili**；**语言只控制 UI**，不驱动 video provider。
6. **Practice Mode**：保留 Web canonical 行为；**勿**硬编码首小节 rests/lead-in；时间轴从 **MIDI/MusicXML/OSMD 推导**。
7. **勿**重新引入大规模 **heavy backdrop-filter** 堆砌；优先设计系统已有「无 backdrop」tile 方案。
8. **勿**覆盖他人未提交工作；**先 `git status`**。
9. **小而专注的 commit**；合并前尽可能跑 **`npm run lint`** 与必要的 `build`。

---

**文档结束**
