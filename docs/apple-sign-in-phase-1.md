# CIP Music 统一账号体系 Phase 1：Apple 登录

更新时间：2026-07-20

## 当前架构

- 网站和 iOS 使用同一个 Supabase 项目。
- iOS 继续使用原生 Apple 授权，并把 Apple `identityToken` 与 nonce 交给 Supabase `signInWithIdToken`。
- 网站使用 Supabase Apple OAuth，并在登录完成后返回发起登录的网站 origin。
- 两端都由 Supabase 根据同一个 Apple 身份提供方标识解析用户；Phase 1 不新增账号合并、邮箱匹配或手动关联逻辑。

## 已配置项目

### Apple Developer

- iOS App ID：`com.cipmusic.aurasounds`
- Web Services ID：`com.cipmusic.aurasounds.web`
- 网站域名：`cipmusic.com`
- Return URL：生产 Supabase Auth callback
- Web Services ID 的 primary App ID 指向现有 iOS App ID。

### Supabase Auth

- Apple provider 保持启用。
- Apple Client IDs 同时包含 Web Services ID 与现有 iOS bundle ID，Web ID 排在第一位。
- Apple client secret 已通过受控本地流程生成并保存到 Supabase，未写入代码库。
- 当前 secret 到期日：2027-01-17。应在到期前轮换，并在轮换后分别回归网站与 iOS 登录。
- Manual linking 保持关闭。

## 验证步骤

使用专门的受控测试 Apple 账号。不要使用个人账号，也不要测试购买或订阅。

1. 在 iOS 使用 `Continue with Apple` 登录，记录 Supabase Dashboard 中对应用户的 `auth.users.id`。比对时只在受控界面内查看；截图或工单中仅保留掩码值。
2. 退出网站当前账号，在 `https://cipmusic.com` 选择 `Continue with Apple`，使用同一个 Apple 测试账号和相同的邮箱共享选项。
3. 在 Supabase Dashboard 确认网站登录没有新建第二个用户，并确认网站 session 的用户 ID 与第 1 步完全相同。
4. 分别在网站和 iOS 退出后重新登录一次，确认 session 恢复、资料读取和登出正常。
5. 对 `Hide My Email` 单独执行一轮：首次授权时选择隐藏邮箱，然后在两端使用同一个 Apple 账号。确认两端落到同一用户 ID；不要通过 relay 邮箱文本自行合并用户。

通过标准：

- Native Apple login `user_id` = Web Apple login `user_id`。
- 同一 Apple 身份在 `auth.users` 中只有一条记录。
- 普通邮箱共享与 `Hide My Email` 两条路径均不会触发自动邮箱合并。
- Email OTP、Google 登录、现有 iOS Apple 登录均无回归。
- Stripe、支付、订阅与 `manual_admin` 未被修改。

## 已知边界

- Apple 只会在首次授权时返回姓名，且邮箱是否为 relay 地址取决于用户首次选择；应用不应依赖后续授权再次返回这些字段。
- 如果同一个人此前分别通过 Email、Google 或不同 Apple 授权上下文生成过多个 Supabase 用户，Phase 1 不负责合并。
- 不允许仅因邮箱字符串相同而自动关联身份。任何后续账号合并功能需要独立设计、显式验证所有权并经过安全评审。

## 回滚

如网站 Apple 登录出现生产故障：

1. 隐藏网站 Apple 按钮并重新发布网站。
2. 保留 iOS bundle ID 在 Supabase Apple Client IDs 中，避免影响现有原生登录。
3. 仅在确认不再影响 iOS 后，才考虑撤销 Web Services ID 或轮换 Apple secret。
