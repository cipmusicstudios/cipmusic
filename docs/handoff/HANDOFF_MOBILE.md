# CIP Music / AuraSounds — 移动端交接（跨仓库）

本文件仅总结 **本机已知的移动端与跨端信息**。  
**Web 主仓库路径**：`钢琴app项目/projects/aurasounds-main-deploy`。  
**移动仓库路径（独立目录）**：`钢琴app项目/projects/aurasounds-mobile`。

## 已确认事实

- **技术栈**：**Expo**（`expo-router`）、**React Native** `0.81.x`、**React** `19.1.x`、`expo-video`、`@supabase/supabase-js`、`@tonejs/midi` 等（以该目录 `package.json` 为准）。
- **与 Web 共享后端**：`aurasounds-mobile/supabase/migrations/README.md` 明确：这些 SQL migration 作用于 **Web 与 Mobile 共用的 Supabase 数据库**；并列出已规划的表变更：
  - `public.songs` 的列表排序字段与索引  
  - `public.user_favorites`、`public.user_recently_played` + RLS  
- **协作含义**：任意修改 **RLS / `songs` schema / 用户库表** 时，需同时考虑两端客户端（readme 中「Mobile: same pattern」）。

## Web 端练习 / 播放器行为的「权威源」

- **练习模式**：以 Web 仓库的 **`src/practice/PracticePanelModule.tsx`**、**`src/musicxml-hand-utils.ts`**、**`src/lib/practice-asset-url.ts`** 为 **canonical**（详见 `HANDOFF_WEB.md`）。移动若实现练习，应对齐该行为而非另起一套 magic 数。
- **练习资源 URL**：仍应通过服务端 broker（Web 已实现 `practice-asset-url`）；**移动端若直连 storage 永久 URL，需单独安全评审**（一般应避免）。

## 未在本机移动仓库深入验证（未知 / 待补）

以下 **未** 在本次交接中逐项阅读 `aurasounds-mobile` 源码确认，接手移动端的 Agent（如 Claude Code）需自行打开仓库核查：

- [ ] 实际导航结构（`expo-router` 路由表）与 Tab 组织  
- [ ] 是否已实现 OSMD / WebView 套壳谱面 / 原生渲染  
- [ ] 与 Netlify Functions 的对接方式（同源 vs 显式 API base URL）  
- [ ] Stripe / ZPay 是否在 App 内集成或仅 WebView  
- [ ] 背景视频 / R2 presign：是否复用 `scene-asset-url` 契约  

## 移动：**建议**手测清单（需在真机/模拟器上由人类或 Agent 执行）

- [ ] `npm install` 后 `npx expo start`，iOS/Android 均能启动  
- [ ] Supabase 匿名/登录会话与曲库读取  
- [ ] 收藏 / 最近播放：登录后与 Supabase 同步；登出后 guest 本地存储（若已实现）  
- [ ] 与 Web 对齐的会员能力：哪些在 App 内可用、哪些跳转 Web  
- [ ] 若含练习模式：MIDI 时长、lead-in、loop 与 Web 行为抽测对比  

---

*若 Cece 将移动仓库迁移到其他路径，请更新本节路径说明。*
