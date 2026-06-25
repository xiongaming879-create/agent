<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor, avatarSrc } from '../composables/useAvatar'

const emit = defineEmits<{
  close: []
}>()

const authStore = useAuthStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const themes: { value: 'dark' | 'auto'; label: string; icon: string }[] = [
  { value: 'dark', label: '暗色', icon: '☾' },
  { value: 'auto', label: '系统', icon: '◐' },
]

const currentTheme = computed(() => authStore.user?.theme || 'auto')

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
  <Transition name="overlay">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-2xl bg-black/60"
      @click.self="emit('close')"
    >
      <Transition name="panel" appear>
        <!-- Outer Shell (Double-Bezel) -->
        <div class="bg-white/5 ring-1 ring-white/10 p-1.5 rounded-[1.5rem] w-[380px]">
          <!-- Inner Core -->
          <div class="bg-[#0A0A0A] rounded-[1.25rem] p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">

            <!-- Header -->
            <div class="flex items-center justify-between mb-8">
              <div>
                <h2 class="text-[15px] font-semibold text-white tracking-tight">设置</h2>
                <p class="text-[11px] text-white/30 mt-0.5 tracking-wide">个性化你的体验</p>
              </div>
              <button
                class="w-7 h-7 rounded-full bg-white/5 ring-1 ring-white/10 flex items-center justify-center hover:bg-white/10 active:scale-[0.95] transition-all duration-200"
                @click="emit('close')"
              >
                <svg class="w-3 h-3 text-white/50" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <!-- Avatar Section (Bento Hero) -->
            <div class="bg-white/5 ring-1 ring-white/10 rounded-[1rem] p-5 mb-5">
              <div class="flex items-center gap-4">
                <!-- Avatar Circle (Double-Bezel) -->
                <div
                  class="relative cursor-pointer group"
                  @click="triggerFileInput"
                >
                  <div class="bg-white/5 ring-1 ring-white/10 p-[3px] rounded-full">
                    <div
                      class="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center relative"
                      :style="!isAvatarImagePath(authStore.user?.avatar || '')
                        ? { backgroundColor: avatarBgColor() }
                        : { backgroundColor: '#1a1a1a' }"
                    >
                      <img
                        v-if="isAvatarImagePath(authStore.user?.avatar || '')"
                        :src="avatarSrc(authStore.user?.avatar || '')"
                        alt="avatar"
                        class="w-full h-full object-cover"
                      />
                      <span v-else class="text-white text-lg font-semibold">
                        {{ getInitialLetter(authStore.user?.username || 'U') }}
                      </span>
                    </div>
                  </div>
                  <!-- Hover overlay -->
                  <div class="absolute inset-0 rounded-full bg-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]">
                    <svg class="w-4 h-4 text-white/80" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"/>
                      <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/>
                    </svg>
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-[13px] text-white/80 font-medium truncate">{{ authStore.user?.username }}</p>
                  <p class="text-[11px] text-white/30 mt-0.5">
                    {{ uploading ? '上传中...' : '点击头像更换' }}
                  </p>
                </div>
              </div>
              <input
                ref="fileInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleFileChange"
              />
            </div>

            <!-- Settings Rows -->
            <div class="space-y-5">
              <!-- Theme -->
              <div>
                <label class="text-[11px] text-white/30 uppercase tracking-[0.12em] font-medium mb-2.5 block">外观主题</label>
                <div class="flex gap-1.5 bg-white/5 ring-1 ring-white/10 rounded-lg p-1">
                  <button
                    v-for="t in themes"
                    :key="t.value"
                    class="flex-1 py-2 text-[12px] rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    :class="currentTheme === t.value
                      ? 'bg-white/10 text-white ring-1 ring-white/10 shadow-[0_2px_8px_rgba(0,0,0,0.3)]'
                      : 'text-white/40 hover:text-white/60'"
                    @click="updateTheme(t.value)"
                  >
                    <span class="mr-1">{{ t.icon }}</span>{{ t.label }}
                  </button>
                </div>
              </div>

              <!-- Font Size -->
              <div>
                <div class="flex items-center justify-between mb-2.5">
                  <label class="text-[11px] text-white/30 uppercase tracking-[0.12em] font-medium">字号大小</label>
                  <span class="text-[12px] text-white/60 tabular-nums font-medium">{{ authStore.user?.font_size || 14 }}px</span>
                </div>
                <div class="relative h-1.5 bg-white/10 rounded-full">
                  <div
                    class="absolute left-0 top-0 h-full bg-white/20 rounded-full transition-all duration-200"
                    :style="{ width: `${((authStore.user?.font_size || 14) - 12) / 8 * 100}%` }"
                  ></div>
                  <input
                    type="range"
                    :min="12"
                    :max="20"
                    :value="authStore.user?.font_size || 14"
                    class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    @change="updateFontSize(Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
                <div class="flex justify-between mt-1.5">
                  <span class="text-[10px] text-white/20">12</span>
                  <span class="text-[10px] text-white/20">20</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.overlay-enter-active { transition: opacity 0.4s ease-[cubic-bezier(0.32,0.72,0,1)]; }
.overlay-leave-active { transition: opacity 0.25s ease-[cubic-bezier(0.32,0.72,0,1)]; }
.overlay-enter-from, .overlay-leave-to { opacity: 0; }

.panel-enter-active { transition: all 0.5s ease-[cubic-bezier(0.32,0.72,0,1)]; }
.panel-leave-active { transition: all 0.2s ease-[cubic-bezier(0.32,0.72,0,1)]; }
.panel-enter-from { opacity: 0; transform: scale(0.96) translateY(8px); }
.panel-leave-to { opacity: 0; transform: scale(0.97); }
</style>
