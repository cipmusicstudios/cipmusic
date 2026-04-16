import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  /** 与 vite.config.ts 同目录为项目根，确保 dev / preview 均能读取根目录 `.env.local` 中的 `VITE_*` */
  const root = path.resolve(__dirname);
  const env = loadEnv(mode, root, '');
  return {
    root,
    envDir: root,
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      include: ['@authing/guard'],
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          preview: path.resolve(__dirname, 'index-preview.html'),
          settingsPreview: path.resolve(__dirname, 'index-settings-preview.html'),
          checkoutPreview: path.resolve(__dirname, 'index-checkout-preview.html'),
          authingSmoke: path.resolve(__dirname, 'authing-smoke.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react-dom')) return 'react-dom';
            if (id.includes('node_modules/react/')) return 'react';
            if (id.includes('node_modules/motion')) return 'motion';
            if (id.includes('node_modules/lucide-react')) return 'icons';
          },
        },
      },
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      /** 避免 @authing/guard 与主应用各打一份 React / Guard，导致 Guard 私有字段与原型错位 */
      dedupe: ['react', 'react-dom', '@authing/guard'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: true,
    },
    preview: {
      allowedHosts: true,
    },
  };
});
