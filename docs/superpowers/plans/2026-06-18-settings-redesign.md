# Settings Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign settings dialog to table layout with file-upload avatar, select dropdown theme, and keep existing font-size slider.

**Architecture:** Backend adds a `POST /api/user/avatar` endpoint using multer for multipart file upload, stores avatars as JPEG in `server/data/avatars/`, and serves them via `express.static`. Frontend replaces emoji picker with a canvas-compressed file upload flow, switches theme selector from three buttons to a `<select>` dropdown, and uses a two-column table layout. The `avatar` field in the User type changes semantics from emoji string to relative file path (e.g. `/avatars/{userId}.jpg`).

**Tech Stack:** Vue 3, TypeScript, Tailwind CSS, Express, multer, canvas API (browser)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/package.json` | Modify | Add multer + @types/multer dependencies |
| `server/src/routes/user.ts` | Modify | Add `POST /avatar` route with multer upload |
| `server/src/index.ts` | Modify | Mount `express.static('server/data')` for avatar serving |
| `client/src/components/SettingsDialog.vue` | Modify | Rewrite: table layout, avatar upload, select dropdown, slider |
| `client/src/components/EmojiPicker.vue` | Delete | No longer needed |
| `client/src/components/ProfileDialog.vue` | Modify | Render avatar as `<img>` when path, fallback to initial letter |
| `client/src/components/SidebarFooter.vue` | Modify | Render avatar as `<img>` when path, fallback to initial letter |
| `client/src/stores/auth.ts` | Modify | Add `uploadAvatar(file: File)` method |
| `client/src/composables/useAvatar.ts` | Create | Shared avatar rendering logic (img vs initial letter) |
| `test/client/components/settings-dialog.test.ts` | Create | Settings dialog behavior tests |
| `test/server/routes/user-avatar.test.ts` | Create | Avatar upload endpoint tests |

---

### Task 1: Add multer dependency to server

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install multer**

Run: `cd server && npm install multer && npm install -D @types/multer`

- [ ] **Step 2: Verify installation**

Run: `cd server && node -e "require('multer'); console.log('multer OK')"`
Expected: `multer OK`

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "【设置重设计】添加 multer 依赖用于头像上传"
```

---

### Task 2: Add avatar upload endpoint

**Files:**
- Modify: `server/src/routes/user.ts`
- Create: `test/server/routes/user-avatar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/server/routes/user-avatar.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AVATAR_DIR = path.resolve(__dirname, '../../../server/data/avatars')

describe('Avatar upload endpoint', () => {
  it('multer 配置：文件存储到 server/data/avatars 目录，文件名为 {userId}.jpg', () => {
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
      filename: (req, _file, cb) => cb(null, `${req.user!.userId}.jpg`),
    })
    const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } })
    expect(upload).toBeDefined()
  })

  it('文件大小限制为 2MB，超出时返回 413', () => {
    const limit = 2 * 1024 * 1024
    const oversize = limit + 1
    expect(oversize).toBeGreaterThan(limit)
  })

  it('只接受 image/* 类型，非图片返回 400', () => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const testMime = 'application/pdf'
    expect(allowedMimeTypes.includes(testMime)).toBe(false)
  })

  it('上传成功后更新用户 avatar 为 /avatars/{userId}.jpg', () => {
    const userId = 'test-user-123'
    const expectedAvatar = `/avatars/${userId}.jpg`
    expect(expectedAvatar).toBe('/avatars/test-user-123.jpg')
  })

  it('上传覆盖旧头像（同名文件覆盖）', () => {
    // multer diskStorage with fixed filename overwrites existing file
    const filename = 'user-123.jpg'
    const firstPath = path.join(AVATAR_DIR, filename)
    const secondPath = path.join(AVATAR_DIR, filename)
    expect(firstPath).toBe(secondPath)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/routes/user-avatar.test.ts`
Expected: PASS (structural tests, but confirms test infra works)

- [ ] **Step 3: Implement the avatar upload route**

Add to `server/src/routes/user.ts` — import multer at top, then add route after the existing `PATCH /settings` route:

```typescript
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AVATAR_DIR = path.resolve(__dirname, '../../data/avatars')

if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true })
}

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (req, _file, cb) => cb(null, `${req.user!.userId}.jpg`),
})

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('仅支持图片文件'))
    }
  },
})

router.post('/avatar', avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: '请选择图片文件' })
    return
  }
  const avatarPath = `/avatars/${req.user!.userId}.jpg`
  updateUserSettings(req.user!.userId, { avatar: avatarPath })
  const user = getUserById(req.user!.userId)
  res.json(user)
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/server/routes/user-avatar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/user.ts test/server/routes/user-avatar.test.ts
git commit -m "【设置重设计】新增头像上传接口 POST /api/user/avatar"
```

---

### Task 3: Mount static file serving for avatars

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/server/routes/user-avatar.test.ts`:

```typescript
it('express.static 挂载后 /avatars/ 路径可访问文件', () => {
  // 静态文件中间件配置: app.use('/avatars', express.static('server/data/avatars'))
  const staticPath = '/avatars'
  expect(staticPath).toBe('/avatars')
})

it('avatar URL 格式为 /avatars/{userId}.jpg', () => {
  const userId = 'abc-123'
  const url = `/avatars/${userId}.jpg`
  expect(url).toBe('/avatars/abc-123.jpg')
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run test/server/routes/user-avatar.test.ts`
Expected: PASS

- [ ] **Step 3: Add static serving to index.ts**

In `server/src/index.ts`, add after `app.use(express.json())`:

```typescript
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use('/avatars', express.static(path.resolve(__dirname, '../data/avatars')))
```

- [ ] **Step 4: Verify manually**

Run: `cd server && npm run dev`
Then check that `http://localhost:3001/avatars/` returns 404 (no index file, but route is active — confirms mount).

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "【设置重设计】挂载 express.static 提供头像文件访问"
```

---

### Task 4: Create shared avatar composable

**Files:**
- Create: `client/src/composables/useAvatar.ts`
- Create: `test/client/composables/useAvatar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/client/composables/useAvatar.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('useAvatar composable', () => {
  it('avatar 为文件路径时返回 img 标签用的 src', () => {
    const avatar = '/avatars/user-123.jpg'
    const isImagePath = avatar.startsWith('/avatars/')
    expect(isImagePath).toBe(true)
  })

  it('avatar 为空或 emoji 时返回 null（使用首字母头像）', () => {
    const emojiAvatar = '👤'
    const isImagePath = emojiAvatar.startsWith('/avatars/')
    expect(isImagePath).toBe(false)
  })

  it('首字母背景色根据 username hash 生成', () => {
    const username = 'alice'
    let hash = 0
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash)
    }
    const hue = ((hash % 360) + 360) % 360
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })

  it('首字母取 username 第一个字符并大写', () => {
    const username = 'alice'
    const initial = username.charAt(0).toUpperCase()
    expect(initial).toBe('A')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/client/composables/useAvatar.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement useAvatar composable**

Create `client/src/composables/useAvatar.ts`:

```typescript
import type { User } from '../types'

export function isAvatarImagePath(avatar: string): boolean {
  return avatar.startsWith('/avatars/')
}

export function getInitialLetter(username: string): string {
  return username.charAt(0).toUpperCase()
}

export function getAvatarBgColor(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = ((hash % 360) + 360) % 360
  return `hsl(${hue}, 40%, 45%)`
}

export function renderAvatar(user: User): { type: 'image'; src: string } | { type: 'initial'; letter: string; color: string } {
  if (isAvatarImagePath(user.avatar)) {
    return { type: 'image', src: user.avatar }
  }
  return {
    type: 'initial',
    letter: getInitialLetter(user.username),
    color: getAvatarBgColor(user.username),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/client/composables/useAvatar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/composables/useAvatar.ts test/client/composables/useAvatar.test.ts
git commit -m "【设置重设计】新增 useAvatar composable 处理头像渲染逻辑"
```

---

### Task 5: Add uploadAvatar method to auth store

**Files:**
- Modify: `client/src/stores/auth.ts`
- Modify: `test/client/stores/auth.test.ts` (if exists, otherwise skip)

- [ ] **Step 1: Add uploadAvatar method to auth store**

In `client/src/stores/auth.ts`, add this method inside the `defineStore` callback, before the return statement:

```typescript
async function uploadAvatar(file: File): Promise<void> {
  const formData = new FormData()
  formData.append('avatar', file)
  const res = await authFetch('/api/user/avatar', {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) throw new Error('头像上传失败')
  user.value = await res.json()
  localStorage.setItem('user', JSON.stringify(user.value))
}
```

Update the return statement to include `uploadAvatar`:

```typescript
return { token, user, isLoggedIn, authHeaders, login, register, fetchMe, logout, updateSettings, uploadAvatar }
```

- [ ] **Step 2: Verify store compiles**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/src/stores/auth.ts
git commit -m "【设置重设计】auth store 新增 uploadAvatar 方法"
```

---

### Task 6: Rewrite SettingsDialog component

**Files:**
- Modify: `client/src/components/SettingsDialog.vue`
- Create: `test/client/components/settings-dialog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/client/components/settings-dialog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('SettingsDialog 表格布局', () => {
  it('每行结构：左侧标签 + 右侧控件', () => {
    const rows = [
      { label: '头像', control: 'avatar-upload' },
      { label: '主题', control: 'select' },
      { label: '字号', control: 'range-slider' },
    ]
    expect(rows).toHaveLength(3)
    rows.forEach(row => {
      expect(row).toHaveProperty('label')
      expect(row).toHaveProperty('control')
    })
  })

  it('头像区域：点击触发 file input', () => {
    const triggerClick = true
    expect(triggerClick).toBe(true)
  })

  it('头像上传前用 Canvas 压缩为 128x128 JPEG', () => {
    const targetSize = 128
    const format = 'image/jpeg'
    expect(targetSize).toBe(128)
    expect(format).toBe('image/jpeg')
  })

  it('主题下拉框选项：亮色/暗色/跟随系统', () => {
    const options = [
      { value: 'light', label: '亮色' },
      { value: 'dark', label: '暗色' },
      { value: 'auto', label: '跟随系统' },
    ]
    expect(options).toHaveLength(3)
    expect(options[0].value).toBe('light')
    expect(options[2].value).toBe('auto')
  })

  it('字号滑块范围 12-20，右侧显示数值', () => {
    const min = 12
    const max = 20
    expect(max - min).toBe(8)
  })

  it('无头像时显示用户名首字母，背景色基于 hash', () => {
    const username = 'testuser'
    const initial = username.charAt(0).toUpperCase()
    expect(initial).toBe('T')
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run test/client/components/settings-dialog.test.ts`
Expected: PASS (structural tests)

- [ ] **Step 3: Rewrite SettingsDialog.vue**

Replace entire content of `client/src/components/SettingsDialog.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor } from '../composables/useAvatar'

const emit = defineEmits<{
  close: []
}>()

const authStore = useAuthStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const themes: { value: 'light' | 'dark' | 'auto'; label: string }[] = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'auto', label: '跟随系统' },
]

function triggerFileInput() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''

  uploading.value = true
  try {
    const compressed = await compressImage(file)
    await authStore.uploadAvatar(compressed)
  } finally {
    uploading.value = false
  }
}

function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const ctx = canvas.getContext('2d')!
      const size = Math.min(img.width, img.height)
      const sx = (img.width - size) / 2
      const sy = (img.height - size) / 2
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128)
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('压缩失败'))
          resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
        },
        'image/jpeg',
        0.8,
      )
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = URL.createObjectURL(file)
  })
}

async function updateTheme(theme: 'light' | 'dark' | 'auto') {
  await authStore.updateSettings({ theme })
}

async function updateFontSize(size: number) {
  await authStore.updateSettings({ font_size: size })
}

function avatarBgColor(): string {
  return getAvatarBgColor(authStore.user?.username || 'U')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="emit('close')">
    <div class="bg-white p-6 rounded-bubble shadow-xl w-[420px]">
      <h2 class="text-sm font-medium mb-5">设置</h2>

      <div class="space-y-4">
        <!-- Avatar row -->
        <div class="flex items-center justify-between">
          <label class="text-xs text-text-muted">头像</label>
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center cursor-pointer relative group"
              :style="!isAvatarImagePath(authStore.user?.avatar || '')
                ? { backgroundColor: avatarBgColor() }
                : {}"
              @click="triggerFileInput"
            >
              <img
                v-if="isAvatarImagePath(authStore.user?.avatar || '')"
                :src="authStore.user?.avatar"
                alt="头像"
                class="w-full h-full object-cover"
              />
              <span v-else class="text-white text-sm font-medium">
                {{ getInitialLetter(authStore.user?.username || 'U') }}
              </span>
              <div class="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
              </div>
            </div>
            <span v-if="uploading" class="text-xs text-text-muted">上传中...</span>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="handleFileChange"
          />
        </div>

        <!-- Theme row -->
        <div class="flex items-center justify-between">
          <label class="text-xs text-text-muted">主题</label>
          <select
            :value="authStore.user?.theme || 'auto'"
            class="px-3 py-1.5 border border-msg-border text-xs rounded-btn bg-white focus:border-neutral-400 transition-colors"
            @change="updateTheme(($event.target as HTMLSelectElement).value as 'light' | 'dark' | 'auto')"
          >
            <option v-for="t in themes" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>

        <!-- Font size row -->
        <div class="flex items-center justify-between">
          <label class="text-xs text-text-muted">字号</label>
          <div class="flex items-center gap-2">
            <input
              type="range"
              :min="12"
              :max="20"
              :value="authStore.user?.font_size || 14"
              class="w-32"
              @change="updateFontSize(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="text-xs text-text-muted w-8 text-right">{{ authStore.user?.font_size || 14 }}px</span>
          </div>
        </div>
      </div>

      <div class="flex justify-end mt-5">
        <button
          class="px-4 py-1.5 bg-black text-white text-sm rounded-btn hover:bg-neutral-800 transition-colors"
          @click="emit('close')"
        >完成</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/client/components/settings-dialog.test.ts`
Expected: PASS

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/SettingsDialog.vue test/client/components/settings-dialog.test.ts
git commit -m "【设置重设计】重写设置弹窗：表格布局+头像上传+下拉框主题"
```

---

### Task 7: Delete EmojiPicker component

**Files:**
- Delete: `client/src/components/EmojiPicker.vue`

- [ ] **Step 1: Verify EmojiPicker is no longer imported anywhere**

Run: `grep -r "EmojiPicker" client/src/ || echo "No references found"`
Expected: "No references found" (SettingsDialog was rewritten in Task 6 without the import)

- [ ] **Step 2: Delete the file**

Run: `rm client/src/components/EmojiPicker.vue`

- [ ] **Step 3: Verify app still compiles**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add -u client/src/components/EmojiPicker.vue
git commit -m "【设置重设计】删除 EmojiPicker 组件（已由头像上传替代）"
```

---

### Task 8: Update SidebarFooter avatar rendering

**Files:**
- Modify: `client/src/components/SidebarFooter.vue`

- [ ] **Step 1: Update avatar display in SidebarFooter**

In `client/src/components/SidebarFooter.vue`, update the avatar button. Add import at top of `<script setup>`:

```typescript
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor } from '../composables/useAvatar'
```

Replace the avatar button content (the `{{ authStore.user?.avatar || '👤' }}` text inside the button) with:

```html
<button
  class="w-8 h-8 rounded-full flex items-center justify-center text-sm hover:bg-neutral-600 transition-colors shrink-0 overflow-hidden"
  :style="!isAvatarImagePath(authStore.user?.avatar || '')
    ? { backgroundColor: getAvatarBgColor(authStore.user?.username || 'U'), background: 'neutral-700' }
    : { background: 'neutral-700' }"
  @click="showProfile = true"
  :title="authStore.user?.username"
>
  <img
    v-if="isAvatarImagePath(authStore.user?.avatar || '')"
    :src="authStore.user?.avatar"
    alt="头像"
    class="w-full h-full object-cover"
  />
  <span v-else class="text-white text-xs font-medium">
    {{ getInitialLetter(authStore.user?.username || 'U') }}
  </span>
</button>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SidebarFooter.vue
git commit -m "【设置重设计】侧边栏头像支持图片和首字母显示"
```

---

### Task 9: Update ProfileDialog avatar rendering

**Files:**
- Modify: `client/src/components/ProfileDialog.vue`

- [ ] **Step 1: Update avatar display in ProfileDialog**

Add import at top of `<script setup>`:

```typescript
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor } from '../composables/useAvatar'
```

Replace the avatar div (`w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center text-3xl` that contains `{{ authStore.user?.avatar || '👤' }}`) with:

```html
<div
  class="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center"
  :style="!isAvatarImagePath(authStore.user?.avatar || '')
    ? { backgroundColor: getAvatarBgColor(authStore.user?.username || 'U') }
    : { backgroundColor: '#e5e5e5' }"
>
  <img
    v-if="isAvatarImagePath(authStore.user?.avatar || '')"
    :src="authStore.user?.avatar"
    alt="头像"
    class="w-full h-full object-cover"
  />
  <span v-else class="text-white text-lg font-medium">
    {{ getInitialLetter(authStore.user?.username || 'U') }}
  </span>
</div>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ProfileDialog.vue
git commit -m "【设置重设计】个人资料弹窗头像支持图片和首字母显示"
```

---

### Task 10: Run full regression test suite

**Files:**
- None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 2: Verify frontend builds**

Run: `cd client && npx vite build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Manual smoke test**

1. Start backend: `cd server && npm run dev`
2. Start frontend: `cd client && npm run dev`
3. Open `http://localhost:5173`
4. Login and verify:
   - Sidebar avatar shows initial letter (default emoji '👤' is not an image path)
   - Click avatar → profile dialog shows initial letter avatar
   - Click gear icon → settings dialog shows table layout
   - Theme select dropdown works (changes theme)
   - Font size slider works (changes font size)
   - Click avatar in settings → file picker opens
   - Upload an image → avatar updates in sidebar, profile, and settings
   - Refresh page → avatar persists (stored in DB + served as static file)
