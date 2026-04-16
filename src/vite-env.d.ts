/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SONGS_MANIFEST_URL?: string;
  /** Guest 注册页完整 URL（游客弹窗 / Account） */
  readonly VITE_AUTH_SIGNUP_URL?: string;
  /** Guest 登录页完整 URL */
  readonly VITE_AUTH_LOGIN_URL?: string;

  /** Authing 应用 ID（Guard） */
  readonly VITE_AUTHING_APP_ID?: string;
  /** Authing 控制台应用域名，如 https://xxx.authing.cn */
  readonly VITE_AUTHING_APP_HOST?: string;
  /**
   * OIDC 回调 URL，须与 Authing 控制台「登录回调 URL」一致（本地 dev 默认端口见 package.json `dev`）。
   * 不填则默认 `origin + pathname`。
   */
  readonly VITE_AUTHING_REDIRECT_URI?: string;
  /** Guard 界面语言，如 zh-CN、en-US */
  readonly VITE_AUTHING_LANG?: string;
  /** 登出后重定向（可选）；不填则用当前 origin + pathname */
  readonly VITE_AUTHING_LOGOUT_REDIRECT_URI?: string;
  /** 覆盖 ZPay 下单 Function URL（默认 `/.netlify/functions/create-zpay-order`） */
  readonly VITE_ZPAY_CREATE_ORDER_URL?: string;
  /** 覆盖会员读取 Function URL（默认 `/.netlify/functions/read-membership`） */
  readonly VITE_READ_MEMBERSHIP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
