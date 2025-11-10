const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function api<T>(path: string, options: RequestInit = {}) {
  const { headers, ...rest } = options
  const response = await fetch(path, {
    headers: { ...JSON_HEADERS, ...headers },
    ...rest,
  })
  if (response.status === 204) {
    return null as unknown as T
  }
  const payload = await response.json()
  if (!response.ok) {
    const message = payload?.detail || 'Request failed'
    throw new Error(message)
  }
  return payload as T
}
