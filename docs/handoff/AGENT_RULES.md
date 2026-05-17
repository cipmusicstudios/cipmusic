# Agent 工作规则（CIP Music / AuraSounds）

本文档约束 **未来所有接手本项目的编程 Agent**（Codex、Claude、Cursor Agent 等）。与 Cece 的用户级规则一致处，以 **Cece 在用户设置中配置的规则为准**。

## 1. 与 Cece 的沟通语言

- **向 Cece 汇报进度、解释用户可见行为、总结验收结果**：使用 **简体中文**。  
- **代码引用、错误栈、标识符、提交说明（若用英文项目习惯）**：保持原样；可与中文说明并列。  
- **实现笔记 / 给其它 Agent 的技术 Prompt / 提交到仓库的长篇 design note**：默认使用 **英文**，**除非** Cece 明确要求中文。

## 2. Git 与协作纪律

- **任何编辑前先运行** `git status`；**禁止**在不知情下覆盖他人未提交修改。  
- **默认不要**主动 `git commit`，除非 Cece **明确**要求；若要求提交：小步、聚焦、信息完整。  
- **禁止** force push 到 `main` / `master`；**禁止**对 **已推送** commit 执行 `amend`（除非 Cece 明确要求并理解后果）。  
- **不要**修改用户的 **全局 git config**。

## 3. 安全与密钥

- **绝不**将以下任一类内容写入代码、文档、日志、截图：**Supabase service role**、私的 signed URL **模板+_token**、R2/云厂商 secret、Stripe secret、ZPay key、Webhook signing secret、用户 cookie、JWT。  
- **绝不**把 **长期可用的私有 Storage / R2 URL** 暴露给前端 bundle；继续沿用 **broker**（`practice-asset-url`、`scene-asset-url`）。  
- **绝不**为图省事 **放宽 Supabase RLS** 或把练习资源对 anon 开放 SELECT。  
- 支付/会员逻辑变更：**必须先**写清 **行为_delta + 风险 + 回滚**（在 PR 描述或 `KNOWN_ISSUES.md`/`HANDOFF_*` 中），再改代码。

## 4. 产品与播放行为（硬规则）

- **视频提供方**（YouTube vs Bilibili）**不得**由 **UI 语言**单独决定。  
  - **中国大陆发行/地区模式**：可默认 **简体中文 UI** 且 **优先 Bilibili**。  
  - **非中国大陆**：必须 **优先 YouTube**，**即使** UI 为中文。  
  - 当前代码使用前端安全变量 **`VITE_DISTRIBUTION_REGION`** 作为最小发行/地区模型；后续如改为远程配置，仍不得回退到 UI 语言判断。
- **练习模式 timing / rest / lead-in**：必须以 Web **`PracticePanelModule.tsx` + `musicxml-hand-utils.ts`** 为 **canonical**；**禁止**硬编码「第一小节休止/lead-in 常数」替代 MIDI/XML 推导。  
- **性能**：避免重新引入大面积 **heavy `backdrop-filter`**；遵循 `MusicTab` / `premium-ui` 的性能路线。

## 5. 工程实施方式

- **优先最小变更**：除非 Cece 要求大规模重构，否则避免「顺手重写」。  
- **单一任务单一 PR / commit 系列**：可拆分则拆分。  
- **变更结束后**向 Cece 汇报需包含：**改了哪些文件（路径列表）**、**跑了哪些验证命令及结果**。

## 6. 验证习惯

- 改 TypeScript/React 后尽量运行 **`npm run lint`**（`tsc --noEmit`）。  
- 动 manifest / 构建链时补充 **`npm run build`**（允许在说明里标注耗时）。  
- 本仓库 **无** 默认 `npm test`；不要假设存在单元测试套件。

## 7. 「Do not break」速查

来自 Cece 与 `HANDOFF_WEB.md`，**违反需立即回滚并说明**：

1. 不暴露私有 Supabase/R2 资产 URL 于前端 bundle。  
2. 不暴露 service role 或私有 storage 直链给浏览器。  
3. 不削弱 Supabase RLS。  
4. 不重写支付/订阅/会员/安全逻辑而不写清影响。  
5. 境外：视频链接 **优先 YouTube**；仅中国大陆发行默认简中且 **优先 Bilibili**；**语言 ≠ video provider**。  
6. Practice Mode 行为 **对齐 Web canonical**；timing 来源于 MIDI/MusicXML 逻辑。  
7. 避免重度 `backdrop-filter` 回归。  
8. 不覆盖未提交的用户工作；改前 **`git status`**。  
9. 小步提交；尽量跑最安全的可用验证命令。

---

若 Cursor / Codex 有内置「user rules」，与本文件冲突时 **以更严格的一侧** 为准。
