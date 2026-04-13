# 部署检查清单（上线前必看）

## 1. Supabase 环境变量

构建前必须存在（写入 `.env` 或 CI 密钥），否则 `src/lib/supabase.ts` 会在加载时报错、页面白屏：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

（可选）若 manifest 托管在 CDN：`VITE_SONGS_MANIFEST_URL` 指向完整 `songs-manifest.json` URL。

## 2. Build / Deploy 命令

```bash
npm ci          # 或 npm install
npm run build   # 含 prebuild：会先生成 public/songs-manifest.json 等，再 vite build
```

产物目录：`dist/`。静态托管时将 `dist` 作为站点根目录（默认 `base: /`）。

预览本地产物：`npm run preview`（默认端口以终端提示为准）。

## 3. 预发后手动点检（核心路径）

- 首页 / 曲库列表能加载，无明显白屏或长时间空白  
- 选歌 → **播放** → 进度与 **时长** 正常  
- 有谱曲目：**Practice Mode** 能打开、能关  
- **视频 / 谱子** 外链按钮能打开（或符合产品预期）  
- **艺人页**：进入任一艺人，列表可浏览  
- **分类 / 筛选**：切换标签或分类，结果合理、不卡死  

以上通过后再切生产流量。
