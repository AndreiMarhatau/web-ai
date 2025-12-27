import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom'
import {
  Paper,
  Stack,
  Typography,
  Chip,
  Button,
  TextField,
  Divider,
  Card,
  CardContent,
  CardHeader,
  Skeleton,
  Alert,
  Tabs,
  Tab,
  Box,
} from '@mui/material'
import { api } from '../api'
import type { TaskDetail, TaskStatus } from '../types'
import { useApiStatus } from '../contexts/apiStatus'
import { statusTone } from '../utils/status'
import ConfirmDialog from '../components/ConfirmDialog'

const blockedStatuses: TaskStatus[] = ['pending', 'scheduled', 'running', 'waiting_for_input']

type ConfirmAction = 'close-browser' | 'stop-task' | null

type TabValue = 'progress' | 'chat'

function toInputDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString()
}

function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { setStatus } = useApiStatus()
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [continuationText, setContinuationText] = useState('')
  const [assistanceText, setAssistanceText] = useState('')
  const [continuing, setContinuing] = useState(false)
  const [assisting, setAssisting] = useState(false)
  const [scheduleInput, setScheduleInput] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [runningNow, setRunningNow] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [openingAdminVnc, setOpeningAdminVnc] = useState(false)
  const [activeTab, setActiveTab] = useState<TabValue>('progress')
  const [pageError, setPageError] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [continuationError, setContinuationError] = useState<string | null>(null)
  const [assistError, setAssistError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)

  const nodeId = searchParams.get('node') || searchParams.get('node_id') || ''
  const nodeSuffix = nodeId ? `?node_id=${nodeId}` : ''

  const loadDetail = useCallback(async () => {
    if (!taskId) {
      return
    }
    setLoading(true)
    try {
      const data = await api<TaskDetail>(`/api/tasks/${taskId}${nodeSuffix}`)
      setDetail(data)
      if (!nodeId && data.record.node_id) {
        setSearchParams({ node: data.record.node_id })
      }
      setStatus('Detail updated', 'success')
      setPageError(null)
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    } finally {
      setLoading(false)
    }
  }, [nodeId, nodeSuffix, setSearchParams, setStatus, taskId])

  useEffect(() => {
    loadDetail()
    const timer = setInterval(() => {
      loadDetail()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadDetail])

  useEffect(() => {
    if (detail?.record.scheduled_for) {
      setScheduleInput(toInputDate(detail.record.scheduled_for))
    } else {
      setScheduleInput('')
    }
  }, [detail?.record.scheduled_for])

  const record = detail?.record
  const canContinue = Boolean(record && !blockedStatuses.includes(record.status))
  const canStop = record?.status === 'running'
  const nodeLabel = nodeId || record?.node_id || 'default'

  const handleContinue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!record) {
      return
    }
    const instructions = continuationText.trim()
    if (!instructions) {
      setContinuationError('Describe what the agent should do next.')
      return
    }
    setContinuationError(null)
    setContinuing(true)
    try {
      await api(`/api/tasks/${record.id}/continue${nodeSuffix}`, {
        method: 'POST',
        body: JSON.stringify({ instructions }),
      })
      setContinuationText('')
      setStatus('Task continuation queued', 'success')
      await loadDetail()
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    } finally {
      setContinuing(false)
    }
  }

  const handleAssist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!record) {
      return
    }
    const response = assistanceText.trim()
    if (!response) {
      setAssistError('Response cannot be empty.')
      return
    }
    setAssistError(null)
    setAssisting(true)
    try {
      await api(`/api/tasks/${record.id}/assist${nodeSuffix}`, {
        method: 'POST',
        body: JSON.stringify({ message: response }),
      })
      setAssistanceText('')
      setStatus('Response sent', 'success')
      await loadDetail()
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    } finally {
      setAssisting(false)
    }
  }

  const handleRunNow = async () => {
    if (!record) {
      return
    }
    setRunningNow(true)
    try {
      await api(`/api/tasks/${record.id}/run-now${nodeSuffix}`, { method: 'POST' })
      setStatus('Scheduled task started', 'success')
      await loadDetail()
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    } finally {
      setRunningNow(false)
    }
  }

  const handleReschedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!record) {
      return
    }
    if (!scheduleInput) {
      setScheduleError('Choose a start time to reschedule.')
      return
    }
    const parsed = new Date(scheduleInput)
    if (Number.isNaN(parsed.getTime())) {
      setScheduleError('Invalid date/time.')
      return
    }
    if (parsed.getTime() <= Date.now()) {
      setScheduleError('Scheduled time must be in the future.')
      return
    }
    setScheduleError(null)
    setRescheduling(true)
    try {
      await api(`/api/tasks/${record.id}/schedule${nodeSuffix}`, {
        method: 'POST',
        body: JSON.stringify({ scheduled_for: parsed.toISOString() }),
      })
      setStatus('Schedule updated', 'success')
      await loadDetail()
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    } finally {
      setRescheduling(false)
    }
  }

  const handleCloseBrowser = async () => {
    if (!record) {
      return
    }
    setConfirmAction(null)
    try {
      await api(`/api/tasks/${record.id}/close-browser${nodeSuffix}`, { method: 'POST' })
      setStatus('Browser closed', 'success')
      await loadDetail()
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    }
  }

  const handleOpenBrowser = async () => {
    if (!record) {
      return
    }
    try {
      await api(`/api/tasks/${record.id}/open-browser${nodeSuffix}`, { method: 'POST' })
      setStatus('Browser reopened', 'success')
      await loadDetail()
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    }
  }

  const handleOpenAssist = () => {
    if (!detail?.vnc_launch_url) {
      return
    }
    window.open(detail.vnc_launch_url, '_blank')
  }

  const handleStopTask = async () => {
    if (!record || !canStop) {
      return
    }
    setConfirmAction(null)
    setStopping(true)
    try {
      await api(`/api/tasks/${record.id}/stop${nodeSuffix}`, { method: 'POST' })
      setStatus('Task stopped', 'success')
      await loadDetail()
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    } finally {
      setStopping(false)
    }
  }

  const handleOpenAdminVnc = async () => {
    if (!record) {
      return
    }
    setOpeningAdminVnc(true)
    try {
      const payload = await api<{ vnc_url: string }>(`/api/tasks/${record.id}/admin-vnc${nodeSuffix}`, {
        method: 'POST',
      })
      window.open(payload.vnc_url, '_blank')
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setPageError(message)
    } finally {
      setOpeningAdminVnc(false)
    }
  }

  if (!taskId) {
    return (
      <Paper sx={{ p: 4 }}>
        <Typography color="text.secondary">Missing task ID.</Typography>
      </Paper>
    )
  }

  return (
    <Paper sx={{ p: { xs: 3, md: 4 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }}>
        <div>
          <Typography variant="h5">Task control</Typography>
          <Typography variant="body2" color="text.secondary">
            Inspect progress, chat, and the preserved browser session.
          </Typography>
        </div>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button component={RouterLink} to="/" variant="outlined">
            Back to tasks
          </Button>
          <Chip label={`Node: ${nodeLabel}`} variant="outlined" />
          <Chip
            label={record ? record.status.replace(/_/g, ' ') : loading ? 'Loading…' : 'Unknown'}
            color={record ? statusTone(record.status, record.needs_attention) : 'default'}
            variant="outlined"
          />
        </Stack>
      </Stack>
      <Divider sx={{ my: 3 }} />
      {pageError && <Alert severity="error" sx={{ mb: 3 }}>
        {pageError}
      </Alert>}
      {loading && !detail ? (
        <Skeleton variant="rounded" height={240} />
      ) : detail ? (
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 360px) minmax(0, 1fr)' },
            minWidth: 0,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack spacing={2}>
              <Card>
                <CardHeader title={record?.title} subheader={`Model: ${record?.model_name}`} />
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip
                        label={record ? record.status.replace(/_/g, ' ') : 'unknown'}
                        color={record ? statusTone(record.status, record.needs_attention) : 'default'}
                        size="small"
                      />
                      {record?.needs_attention && <Chip label="Needs input" color="warning" size="small" />}
                      {record?.browser_open && <Chip label="Browser open" color="success" size="small" />}
                    </Stack>
                    <Divider />
                    <Stack spacing={1}>
                      <Stack direction="row" justifyContent="space-between" sx={{ gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary">Steps</Typography>
                        <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                          {record?.step_count}/{record?.max_steps}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" sx={{ gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary">Created</Typography>
                        <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                          {formatDate(record?.created_at)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" sx={{ gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary">Updated</Typography>
                        <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                          {formatDate(record?.updated_at)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" sx={{ gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary">Scheduled</Typography>
                        <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                          {record?.scheduled_for ? formatDate(record?.scheduled_for) : 'Not scheduled'}
                        </Typography>
                      </Stack>
                    </Stack>
                    {record?.last_error && <Alert severity="error">{record.last_error}</Alert>}
                  </Stack>
                </CardContent>
              </Card>

              <Card>
                <CardHeader title="Session controls" subheader="Live browser session and safety controls." />
                <CardContent>
                  <Stack spacing={1.5}>
                    {record?.browser_open ? (
                      <Button onClick={() => setConfirmAction('close-browser')} color="error" variant="contained">
                        Close browser session
                      </Button>
                    ) : (
                      <Button onClick={handleOpenBrowser} variant="outlined">
                        Reopen browser session
                      </Button>
                    )}
                    <Button
                      onClick={handleOpenAdminVnc}
                      variant="outlined"
                      disabled={!record?.browser_open || openingAdminVnc}
                    >
                      {openingAdminVnc ? 'Opening…' : 'Open live VNC (view-only)'}
                    </Button>
                    <Button
                      onClick={() => setConfirmAction('stop-task')}
                      color="warning"
                      variant="contained"
                      disabled={!canStop || stopping}
                    >
                      {stopping ? 'Stopping…' : 'Stop task'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>

              {record?.status === 'scheduled' && (
                <Card>
                  <CardHeader title="Scheduling" subheader="Adjust timing for this run." />
                  <CardContent component="form" onSubmit={handleReschedule} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      type="datetime-local"
                      label="Start time"
                      value={scheduleInput}
                      onChange={(event) => {
                        setScheduleInput(event.target.value)
                        setScheduleError(null)
                      }}
                      required
                      fullWidth
                      error={Boolean(scheduleError)}
                      helperText={scheduleError || 'Choose a future time to restart the schedule.'}
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <Button type="submit" variant="outlined" disabled={rescheduling}>
                        {rescheduling ? 'Updating…' : 'Update schedule'}
                      </Button>
                      <Button variant="contained" onClick={handleRunNow} disabled={runningNow}>
                        {runningNow ? 'Starting…' : 'Run now'}
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              )}

              {record?.needs_attention && (
                <Card>
                  <CardHeader title="Assistance requested" subheader={record.assistance?.question || 'Agent waiting for guidance.'} />
                  <CardContent component="form" onSubmit={handleAssist} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {detail?.vnc_launch_url && (
                      <Button onClick={handleOpenAssist} variant="outlined" disabled={!record?.browser_open}>
                        Open assist session
                      </Button>
                    )}
                    <TextField
                      multiline
                      minRows={3}
                      placeholder="Type your response"
                      value={assistanceText}
                      onChange={(event) => {
                        setAssistanceText(event.target.value)
                        setAssistError(null)
                      }}
                      fullWidth
                      error={Boolean(assistError)}
                      helperText={assistError || ''}
                    />
                    <Button type="submit" variant="contained" disabled={assisting}>
                      {assisting ? 'Sending…' : 'Send response'}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </Stack>
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Stack spacing={2}>
              <Card>
                <CardHeader title="Task feed" subheader="Progress summaries and conversation context." />
                <CardContent>
                  <Tabs
                    value={activeTab}
                    onChange={(_, value) => setActiveTab(value as TabValue)}
                    sx={{ mb: 2 }}
                  >
                    <Tab value="progress" label={`Progress (${detail.steps.length})`} />
                    <Tab value="chat" label={`Chat (${detail.chat_history.length})`} />
                  </Tabs>
                  {activeTab === 'progress' ? (
                    detail.steps.length ? (
                      <Stack spacing={2}>
                        {detail.steps.map((step) => (
                          <Paper key={`step-${step.step_number}`} variant="outlined" sx={{ p: 2 }}>
                            <Stack spacing={1}>
                              <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Chip label={`Step ${step.step_number}`} size="small" color="primary" />
                                {step.url && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ maxWidth: '70%', overflowWrap: 'anywhere' }}
                                  >
                                    {step.url}
                                  </Typography>
                                )}
                              </Stack>
                              {step.title && (
                                <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
                                  {step.title}
                                </Typography>
                              )}
                              {step.summary_html && (
                                <Box
                                  sx={{
                                    '& p': { margin: 0 },
                                    '& a': { color: 'primary.main' },
                                    overflowWrap: 'anywhere',
                                    wordBreak: 'break-word',
                                  }}
                                  dangerouslySetInnerHTML={{ __html: step.summary_html }}
                                />
                              )}
                              {step.screenshot_b64 && (
                                <img
                                  src={`data:image/jpeg;base64,${step.screenshot_b64}`}
                                  alt={`Step ${step.step_number} screenshot`}
                                  style={{ marginTop: 8, width: '100%', borderRadius: 12 }}
                                />
                              )}
                            </Stack>
                          </Paper>
                        ))}
                      </Stack>
                    ) : (
                      <Typography color="text.secondary">Waiting for first step…</Typography>
                    )
                  ) : detail.chat_history.length ? (
                    <Stack spacing={2}>
                      {detail.chat_history.map((msg, index) => (
                        <Paper key={`${msg.role}-${index}`} variant="outlined" sx={{ p: 2 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.2em' }}>
                            {msg.role}
                          </Typography>
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                            {msg.content}
                          </Typography>
                        </Paper>
                      ))}
                    </Stack>
                  ) : (
                    <Typography color="text.secondary">Waiting for chat history…</Typography>
                  )}
                </CardContent>
              </Card>

              {canContinue && (
                <Card>
                  <CardHeader title="Continue task" subheader="Provide a follow-up instruction using the existing session." />
                  <CardContent component="form" onSubmit={handleContinue} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      multiline
                      minRows={3}
                      placeholder="Describe what to do next"
                      value={continuationText}
                      onChange={(event) => {
                        setContinuationText(event.target.value)
                        setContinuationError(null)
                      }}
                      fullWidth
                      error={Boolean(continuationError)}
                      helperText={continuationError || ''}
                    />
                    <Button type="submit" variant="contained" disabled={continuing}>
                      {continuing ? 'Queuing…' : 'Continue task'}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </Stack>
          </Box>
        </Box>
      ) : (
        <Typography color="text.secondary">Unable to load task detail.</Typography>
      )}
      <ConfirmDialog
        open={confirmAction === 'close-browser'}
        title="Close browser session"
        description="Closing the browser will discard the preserved session. Continue?"
        confirmLabel="Close browser"
        confirmColor="error"
        onClose={() => setConfirmAction(null)}
        onConfirm={handleCloseBrowser}
      />
      <ConfirmDialog
        open={confirmAction === 'stop-task'}
        title="Stop running task"
        description="Stopping the task ends the current session immediately. Continue?"
        confirmLabel="Stop task"
        confirmColor="warning"
        onClose={() => setConfirmAction(null)}
        onConfirm={handleStopTask}
      />
    </Paper>
  )
}

export default TaskDetailPage
