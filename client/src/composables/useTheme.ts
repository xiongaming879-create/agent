import { ref, watchEffect } from 'vue'
import { useAuthStore } from '../stores/auth'

const systemPrefersDark = ref(
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true,
)

let initialized = false

function listenSystem() {
  if (initialized) return
  initialized = true
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemPrefersDark.value = e.matches
  })
}

export function useTheme() {
  listenSystem()
  const authStore = useAuthStore()

  watchEffect(() => {
    const theme = authStore.user?.theme || 'auto'
    const dark = theme === 'dark' || (theme === 'auto' && systemPrefersDark.value)
    document.documentElement.classList.toggle('dark', dark)
  })
}
