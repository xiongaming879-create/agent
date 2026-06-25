import { onMounted, onUnmounted } from 'vue'

type KeyHandler = () => void

const handlers = new Map<string, KeyHandler>()

function keyCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  parts.push(e.key)
  return parts.join('+')
}

export function useKeyboard(map: Record<string, KeyHandler>) {
  function onKeydown(e: KeyboardEvent) {
    const combo = keyCombo(e)
    const handler = handlers.get(combo)
    if (handler) {
      e.preventDefault()
      handler()
    }
  }

  onMounted(() => {
    for (const [key, fn] of Object.entries(map)) {
      handlers.set(key, fn)
    }
    window.addEventListener('keydown', onKeydown)
  })

  onUnmounted(() => {
    for (const key of Object.keys(map)) {
      handlers.delete(key)
    }
    window.removeEventListener('keydown', onKeydown)
  })
}
