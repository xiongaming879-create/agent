import { useAuthStore } from '../stores/auth'

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const authStore = useAuthStore()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
    ...authStore.authHeaders(),
  }
  const res = await fetch(url, { ...options, headers })
  if (res.status === 401) {
    authStore.logout()
    window.location.href = '/login'
  }
  return res
}
