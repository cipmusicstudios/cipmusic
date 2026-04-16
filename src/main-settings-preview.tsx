import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {SupabaseAuthProvider} from './auth/supabase-auth-provider.tsx';
import './index.css';

/** 独立预览入口（index-settings-preview.html）：启动后直达 Settings，便于查看 Account 会员状态块等布局 */
if (typeof window !== 'undefined') {
  window.location.hash = 'settings-preview';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SupabaseAuthProvider>
      <App />
    </SupabaseAuthProvider>
  </StrictMode>,
);
