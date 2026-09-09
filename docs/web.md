# Hadice 官网（docs/web）

## 介绍

`docs/web` 是 Hadice 的官网，使用 [VitePress](https://vitepress.dev/) 构建，包含首页、下载页与功能文档（中文为主），支持深浅色切换与中英切换（首页、下载页提供英文版）。

## 本地开发与构建

```bash
cd docs/web
npm install
npm run docs:dev       # 本地预览：http://localhost:5173/hadice/
npm run docs:build     # 产物输出到 .vitepress/dist
npm run docs:preview   # 预览构建产物
```

站点 `base` 为 `/hadice/`，对应 GitHub Pages 项目页 `https://<owner>.github.io/hadice/`。如绑定自定义域名，需将 `base` 改为 `/`。

## 下载地址说明

下载页的 `DownloadCards` 组件实时读取 GitHub Releases：

- 请求 `https://api.github.com/repos/HuolalaTech/hadice/releases/latest`
- 按文件名匹配资产：macOS arm64 / x64 的 `.dmg`、Windows 的 `.exe`
- 匹配成功：显示版本号、文件名、大小，按钮直连安装包
- 读取失败或资产缺失：按钮自动跳转 `https://github.com/HuolalaTech/hadice/releases/latest`

发布 Release 时请按上述命名规则上传安装包，下载页即可自动展示。

## GitHub Pages 部署

已配置 `.github/workflows/deploy-pages.yml`，推送到 `main`/`master` 且改动 `docs/web/**` 时自动构建并发布：

1. checkout → setup-node 22 → `npm ci` → `npm run docs:build`
2. configure-pages → 上传 `docs/web/.vitepress/dist` → deploy-pages

首次部署前，需在 GitHub 仓库 Settings → Pages 将 Source 设为 **GitHub Actions**。
