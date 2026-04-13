import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthingAppRoot} from './auth/authing-provider.tsx';
import './index.css';

/** 独立预览入口（index-preview.html）：默认打开玻璃质感预览页，仍可在地址栏去掉 #glass-ui 看完整 App */
if (typeof window !== 'undefined' && !window.location.hash.replace(/^#/, '')) {
  window.location.hash = 'glass-ui';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthingAppRoot>
      <App />
    </AuthingAppRoot>
  </StrictMode>,
);
