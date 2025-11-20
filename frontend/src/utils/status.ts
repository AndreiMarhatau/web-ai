import type { TaskStatus } from '../types'

export function statusTone(status: TaskStatus, needsAttention?: boolean): 'default' | 'success' | 'error' | 'warning' {
  if (status === 'completed') {
    return 'success'
  }
  if (status === 'scheduled') {
    return 'warning'
  }
  if (status === 'failed') {
    return 'error'
  }
  if (needsAttention) {
    return 'warning'
  }
  return 'default'
}
