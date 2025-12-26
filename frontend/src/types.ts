export type TaskStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'cancelled'

export interface TaskSummary {
  node_id: string
  id: string
  title: string
  status: TaskStatus
  browser_open: boolean
  leave_browser_open: boolean
  needs_attention: boolean
  created_at: string
  updated_at: string
  scheduled_for?: string | null
  step_count: number
  model_name: string
}

export interface TaskRecord extends TaskSummary {
  instructions: string
  reasoning_effort?: string
  max_steps: number
  last_error?: string
  assistance?: {
    question: string
    response_text?: string
  }
}

export interface TaskStep {
  step_number: number
  summary_html?: string
  screenshot_b64?: string | null
  url?: string | null
  title?: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface TaskDetail {
  record: TaskRecord
  steps: TaskStep[]
  chat_history: ChatMessage[]
  vnc_launch_url?: string | null
}

export interface ConfigDefaults {
  model: string
  temperature: number | null
  max_steps: number
  supportedModels: string[]
  refreshSeconds: number
  openaiBaseUrl: string | null
  leaveBrowserOpen: boolean
  reasoningEffortOptions?: string[]
  reasoningEffortOptionsByModel?: Record<string, string[]>
  schedulingEnabled?: boolean
  scheduleCheckSeconds?: number
  nodeId?: string
  nodeName?: string
}

export interface NodeInfo {
  id: string
  name: string
  url?: string
  ready?: boolean
  issues?: string[]
  reachable?: boolean
  enrollment?: boolean
}

export interface NodesResponse {
  nodes: NodeInfo[]
  public_key: string
  enroll_token?: string | null
}

export interface TaskListError {
  node_id: string
  detail: string
}

export interface TaskListResponse {
  tasks: TaskSummary[]
  errors?: TaskListError[]
}
