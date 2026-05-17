# 已知问题与待确认项

分为 **Web**（本仓库）与 **Mobile**（姊妹仓库）。条目按「事实 / 风险 / 需人确认」记录。

## Web

### 构建与类型检查

- **`npm run lint`（`tsc --noEmit`）**：交接时曾在 **若干 `scripts/*.ts` 与 `src/App.tsx` 等** 上报错（含 `Timeout` 类型、metadata 枚举、`scripts/migrate-local-songs-to-supabase.ts` 等）。**属仓库既有问题**，非本次 `docs/handoff/` 引入。接手后若需 CI 绿灯，需专项治理或拆分 tsconfig（例如 exclude 运维脚本）。

### 缺陷与风险

1. **外链视频提供方 vs 发行地区配置**  
   - **现状**：`App.tsx`「看视频」按钮已通过前端安全变量 `VITE_DISTRIBUTION_REGION` 决定 provider 优先级，而非 `currentLang`。  
   - **规则**：未设置或 `global` 时 **YouTube 优先**、Bilibili fallback；`mainland_china` 时 **Bilibili 优先**、YouTube fallback。  
   - **剩余风险**：`mainland_china` 的最终运维判定仍需 Cece / 运维确认；目前采用构建期 env flag 的最小安全方案。

2. **`read-membership` 返回字段收窄**  
   - **现状**：`netlify/functions/read-membership.ts` 注释说明 **故意不在 JSON 中返回** 若干支付内部字段。  
   - **潜在问题**：`src/lib/membership-remote.ts` 的 `normalizePayload` 仍读取 `stripeSubscriptionStatus`、`paymentProvider` 等；它们可能对 UI **恒为 null**。  
   - **需验证**：Account 页「自动续费」、provider 标记等是否仍正确；必要时扩展 **安全字段白名单** 而非回滚到完整行。

3. **本地 Git 分支可能陈旧**  
   - 记录时刻：分支 `deploy-main-webhook` **落后 `origin/main`**。接手应先同步，避免重复解决已合并问题。

4. **`backdrop-filter` 性能债**  
   - `src/index.css` 与部分 overlay 仍含 **高强度 blur**；低端设备 / 移动 Web 上可能掉帧。新增 UI 应优先无 backdrop 方案（`MusicTab`、`premium-ui` 已有先例）。

5. **纯 `vite dev` 无法测 Netlify Functions**  
   - 会员 broker、练习签名、R2 presign 等路径在本地需 **`netlify dev`** 或指向已部署后端，否则前端走「函数不可用」降级分支。

### 可能未完成 / 管线中的功能

- **练习资源迁移到私有 `practice-assets` + 删除公共直链**：脚本与 Function 注释描述多阶段（Phase D）；**线上实际阶段**需对照 Supabase bucket 与 DB 中 URL 形态确认。  
- **Guest 播放限制**：存在 `src/lib/guest-play-limit.ts`；具体产品策略是否定稿需与 Cece 确认。

## Mobile（基于姊妹仓库表层信息，源码未逐文件审计）

1. **功能对等性未知**：练习模式、Smart Radio、场景视频 broker、ZPay/Stripe 是否完整对齐 Web —— **未知**。  
2. **共用 DB migration**：若仅在一端发布 SQL，另一端可能出现「字段缺失」或 **RLS 阻挡** —— 部署顺序需运维约定（见 `aurasounds-mobile/supabase/migrations/README.md`）。

## 需人工（Cece / 运维）确认的信息

- [ ] 当前 **生产** 与 **预发** 的准确 URL（Netlify / 自定义域）。  
- [ ] Supabase 各环境 project ref 与 **RLS** 是否与迁移 README 一致。  
- [ ] R2 bucket 与 `CF_R2_*` 是否已在 Netlify **全环境**配置；scene 对象是否已上传至约定 key。  
- [ ] ZPay/Stripe 商户号、Webhook URL、**IP 白名单** 等运营配置（**不写进文档**）。  
- [ ] 「**中国大陆发行**」判定究竟采用：App Store 区域、手机号、手动开关、还是构建 flavor？（决定 video provider 的最终实现）

---

随问题修复请 **更新本文件**，避免交接过时。
