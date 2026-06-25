# Settings Dialog Redesign Design

## Problem

设置弹窗布局松散，头像仅支持 emoji，主题用三个按钮选择不够紧凑，需要改为表格布局并升级头像为本地文件上传。

## Design

### 前端布局

表格布局，每行左边标签、右边控件：

| 左侧 | 右侧 |
|------|------|
| 头像 | 圆形头像预览 + 点击上传 |
| 主题 | 下拉选择框（亮色/暗色/跟随系统） |
| 字号 | 滑动滑块 + 数值显示 |

### 头像上传

**前端**：
- 点击头像区域触发 `<input type="file" accept="image/*">`
- 选择图片后用 Canvas 压缩/裁剪为 128x128 JPEG
- 通过 `FormData` + `POST /api/user/avatar` 上传（multipart/form-data）
- 上传成功后更新 store 中 avatar 为文件路径 `/avatars/{userId}.jpg`
- 渲染 `<img :src>` 时通过 `avatarSrc()` 动态追加 `?t=时间戳` 参数破坏浏览器缓存，确保上传后立即刷新
- 无头像时显示用户名首字母头像（背景色根据 username hash 生成，纯前端计算）

**后端**：
- 新增 `POST /api/user/avatar` 接口，multer 处理文件上传
- 文件存到 `server/data/avatars/{userId}.jpg`，覆盖旧头像
- avatar 字段从 emoji 字符串改为相对路径
- Express 挂载 `express.static('server/data')` 提供文件访问

### 主题选择

三个按钮改为 `<select>` 下拉框，选项：亮色/暗色/跟随系统。

### 字号选择

保持现有滑动滑块，数值显示在右侧。

## Changes by File

### `server/src/index.ts`
挂载 express.static 提供头像文件访问

### `server/src/routes/user.ts`
新增 POST /api/user/avatar 上传接口（multer）

### `server/package.json`
添加 multer 依赖

### `client/src/components/SettingsDialog.vue`
重写为表格布局：头像上传 + 下拉框主题 + 滑块字号

### `client/src/composables/useAvatar.ts`
共享头像渲染逻辑：isAvatarImagePath、getInitialLetter、getAvatarBgColor、avatarSrc（缓存破坏）

### `client/vite.config.ts`
新增 `/avatars` 代理规则，转发到后端 3001 端口

### `client/src/components/EmojiPicker.vue`
删除（不再需要）

## What This Enables

- 真实头像个性化
- 紧凑的设置布局
- 统一的表单交互风格

## What This Drops

- emoji 头像选择器
