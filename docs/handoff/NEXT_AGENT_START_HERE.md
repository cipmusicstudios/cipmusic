# 下一位 Agent：从这里开始（CIP Music / AuraSounds Web）

本文件是给 **Codex（或任何接手 Web 的编程 Agent）** 的快速入口，约 1～2 页。详细内容见同目录其他文档。

## 1. 先读什么（顺序）

1. **`HANDOFF_WEB.md`** — Web 架构、Practice Mode、会员、部署、数据流的完整交接（主文档）。
2. **`ENVIRONMENT.md`** — 所有环境变量名、前后端边界、占位示例（**不要**填入真实密钥）。
3. **`KNOWN_ISSUES.md`** — 已知缺陷、与产品规则不一致之处、需人工确认项。
4. **`AGENT_RULES.md`** — 写给 Agent 的工作规则（含向 Cece 汇报语言、git 与验证习惯）。
5. **`HANDOFF_MOBILE.md`** — 仅移动端/跨端协作摘要（移动仓库不在本目录）。
6. 根目录 **`DEPLOY.md`**、**`.env.example`** — 上线检查与本地 env 模板。

代码入口：**`src/App.tsx`**（主壳 + 播放 + 场景 + Smart Radio 等），练习模式：**`src/practice/PracticePanelModule.tsx`** + **`src/musicxml-hand-utils.ts`**。

## 2. 如何运行（Web）

- **Node**：`package.json` 指定 **`engines.node`: `20.x`**（请使用 Node 20）。
- **安装**：`npm install`（或 CI 用 `npm ci`）。
- **开发**：`npm run dev`（Vite，默认 **端口 3001**，`0.0.0.0`）。
- **类型检查**：`npm run lint`（实为 `tsc --noEmit`）。
- **构建**：`npm run build`（含 `prebuild`：会跑 manifest 相关步骤后 `vite build`）。
- **预览产物**：`npm run preview` 或 `npm run preview:latest`。

本地 **Netlify Functions**（如 `read-membership`、`practice-asset-url`）在纯 `vite dev` 下 **_默认不存在_**；部分能力会降级或需 Netlify CLI / 部署环境验证（见 `HANDOFF_WEB.md`）。

**最低限度** `.env.local`：至少 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（仅 anon），否则 `src/lib/supabase.ts` 会阻止应用加载。

## 3. 当前最高优先级（建议）

以下为基于仓库现状的 **建议优先级**（需结合 `KNOWN_ISSUES.md` 与 Cece 的产品排期）：

1. **视频外链策略与「语言 / 地区」规则对齐**：当前实现已改用 `VITE_DISTRIBUTION_REGION`，未设置或 `global` 时 YouTube 优先，`mainland_china` 时 Bilibili 优先；仍需确认生产/预发环境的最终配置。
2. **`read-membership` 返回字段 vs `membership-remote.ts` 期望**：后端有意收紧返回字段；确认 Account / 自动续费文案是否仍正确。
3. **本地分支与远端**：本机曾记录为 **`deploy-main-webhook`** 且 **落后 `origin/main` 6 个 commit**；接手后先 `git fetch` / `git status`，避免在陈旧基准上改代码。
4. **Practice / 会员边界**：任何改动涉及 `practice-asset-url`、`has_practice_mode`、签名 TTL、或 MIDI/OSMD 时间轴时，先做 **小步提交** 并在真机上回归练习模式（见 `HANDOFF_WEB.md` 检查清单）。

## 4. 不要碰 / 不要破坏（摘要）

完整列表见 **`AGENT_RULES.md`** 与 **`HANDOFF_WEB.md`** 末尾「Do not break」：

- 勿把 **service role**、长期私有 Storage URL、R2 凭据塞进前端产物。
- 勿放宽 **Supabase RLS** 或绕过已建立的 **broker**（练习资源、付费场景视频）。
- 勿在未写清影响说明的情况下改 **支付 / 订阅 / 会员** 逻辑。
- **Practice Mode** 的 lead-in / 小节时间轴 / AB loop：**以 `PracticePanelModule.tsx` + `musicxml-hand-utils.ts` 为 canonical**；勿硬编码「第一小节休止」类魔法数。
- 避免重新堆 **大范围 `backdrop-filter` 毛玻璃**（历史上有性能问题）；新增 UI 优先固体半透明 + `premium-ui` / `MusicTab` 里采用的轻量方案。

## 5. 改代码前后应执行的命令

- **改前**：`git status`（确认无覆盖他人未提交工作；用户明确要求「提交前看状态」）。
- **改后（安全验证）**：`npm run lint`；若改动涉及构建链路与 manifest，再跑 `npm run build`（较重）。
- **勿** force push `main`、勿 `git commit --amend` 已推送的提交（除非用户明确要求）。

---

**文档生成说明**：路径相对于仓库根 `aurasounds-main-deploy`（AuraSounds / CIP Music Web）。不包含任何真实密钥。
