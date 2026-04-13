import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthingAppRoot} from './auth/authing-provider.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthingAppRoot>
      <App />
    </AuthingAppRoot>
  </StrictMode>,
);
