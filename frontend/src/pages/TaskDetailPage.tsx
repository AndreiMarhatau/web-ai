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
} from '@mui/material'
import { api } from '../api'
import type { TaskDetail, TaskStatus } from '../types'
import { useApiStatus } from '../contexts/apiStatus'
import { statusTone } from '../utils/status'

const blockedStatuses: TaskStatus[] = ['pending', 'scheduled', 'running', 'waiting_for_input']

function toInputDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
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
    } catch (err) {
      setStatus((err as Error).message, 'danger')
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
  const nodeLabel = nodeId || record?.node_id || 'default'

  const handleContinue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!record) {
      return
    }
    const instructions = continuationText.trim()
    if (!instructions) {
      alert('Please describe what the agent should do next.')
      return
    }
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
      alert(message)
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
      alert('Response cannot be empty.')
      return
    }
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
      alert(message)
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
      alert(message)
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
      alert('Choose a start time to reschedule.')
      return
    }
    const parsed = new Date(scheduleInput)
    if (Number.isNaN(parsed.getTime())) {
      alert('Invalid date/time.')
      return
    }
    if (parsed.getTime() <= Date.now()) {
      alert('Scheduled time must be in the future.')
      return
    }
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
      alert(message)
    } finally {
      setRescheduling(false)
    }
  }

  const handleCloseBrowser = async () => {
    if (!record || !window.confirm('Closing the browser will discard the preserved session. Continue?')) {
      return
    }
    await api(`/api/tasks/${record.id}/close-browser${nodeSuffix}`, { method: 'POST' })
    setStatus('Browser closed', 'success')
    await loadDetail()
  }

  const handleOpenBrowser = async () => {
    if (!record) {
      return
    }
    await api(`/api/tasks/${record.id}/open-browser${nodeSuffix}`, { method: 'POST' })
    setStatus('Browser reopened', 'success')
    await loadDetail()
  }

  const handleOpenAssist = () => {
    if (!detail?.vnc_launch_url) {
      return
    }
    window.open(detail.vnc_launch_url, '_blank')
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
          <Typography variant="h5">Task detail</Typography>
          <Typography variant="body2" color="text.secondary">
            Inspect progress, chat, and the preserved browser session.
          </Typography>
        </div>
        <Stack direction="row" spacing={1}>
          <Button component={RouterLink} to="/" variant="outlined">
            Back to tasks
          </Button>
          <Chip label={`Node: ${nodeLabel}`} variant="outlined" />
          <Chip label={record ? record.status : loading ? 'Loading…' : 'Unknown'} color={record ? statusTone(record.status, record.needs_attention) : 'default'} variant="outlined" />
        </Stack>
      </Stack>
      <Divider sx={{ my: 3 }} />
      {loading && !detail ? (
        <Skeleton variant="rounded" height={200} />
      ) : detail ? (
        <Stack spacing={3}>
          <Card variant="outlined">
            <CardHeader title={record?.title} subheader={`Model: ${record?.model_name} • Steps ${record?.step_count}/${record?.max_steps}`} />
            <CardContent>
              <Typography variant="body2" color="text.secondary" paragraph>
                {record?.instructions}
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                {record?.scheduled_for
                  ? `Scheduled for ${new Date(record.scheduled_for).toLocaleString()}`
                  : 'No scheduled start time'}
              </Typography>
              {record?.last_error && (
                <Chip color="error" label={`Error: ${record.last_error}`} sx={{ mb: 2 }} />
              )}
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {record?.browser_open ? (
                  <Button onClick={handleCloseBrowser} color="error" variant="contained">
                    Close browser
                  </Button>
                ) : (
                  <Button onClick={handleOpenBrowser} variant="outlined">
                    Open browser
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>

          {record?.status === 'scheduled' && (
            <Card variant="outlined">
              <CardHeader title="Scheduling" subheader="This task will start automatically at the selected time." />
              <CardContent component="form" onSubmit={handleReschedule} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="datetime-local"
                  label="Start time"
                  value={scheduleInput}
                  onChange={(event) => setScheduleInput(event.target.value)}
                  required
                  fullWidth
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

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
            <Card variant="outlined" sx={{ flex: 1 }}>
              <CardHeader title="Chat history" />
              <CardContent sx={{ maxHeight: 360, overflowY: 'auto' }}>
                {detail.chat_history.length ? (
                  <Stack spacing={2}>
                    {detail.chat_history.map((msg, index) => (
                      <Paper key={`${msg.role}-${index}`} variant="outlined" sx={{ p: 2 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.2em' }}>
                          {msg.role}
                        </Typography>
                        <Typography variant="body2">{msg.content}</Typography>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Typography color="text.secondary">Waiting for chat history…</Typography>
                )}
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ flex: 1 }}>
              <CardHeader title="Progress" />
              <CardContent sx={{ maxHeight: 360, overflowY: 'auto' }}>
                {detail.steps.length ? (
                  <Stack spacing={2}>
                    {detail.steps.map((step) => (
                      <Paper key={`step-${step.step_number}`} variant="outlined" sx={{ p: 2 }}>
                        <Typography variant="subtitle2">Step {step.step_number}</Typography>
                        {step.title && (
                          <Typography variant="body2" color="text.secondary">
                            {step.title}
                          </Typography>
                        )}
                        {step.summary_html && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
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
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Typography color="text.secondary">Waiting for first step…</Typography>
                )}
              </CardContent>
            </Card>
          </Stack>

          {canContinue && (
            <Card variant="outlined">
              <CardHeader title="Continue task" subheader="Give the agent a follow-up instruction with the existing session." />
              <CardContent component="form" onSubmit={handleContinue} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  multiline
                  minRows={3}
                  placeholder="Describe what to do next"
                  value={continuationText}
                  onChange={(event) => setContinuationText(event.target.value)}
                  fullWidth
                />
                <Button type="submit" variant="contained" disabled={continuing}>
                  {continuing ? 'Queuing…' : 'Continue task'}
                </Button>
              </CardContent>
            </Card>
          )}

          {record?.needs_attention && (
            <Card variant="outlined">
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
                  onChange={(event) => setAssistanceText(event.target.value)}
                  fullWidth
                />
                <Button type="submit" variant="outlined" disabled={assisting}>
                  {assisting ? 'Sending…' : 'Send response'}
                </Button>
              </CardContent>
            </Card>
          )}
        </Stack>
      ) : (
        <Typography color="text.secondary">Unable to load task detail.</Typography>
      )}
    </Paper>
  )
}

export default TaskDetailPage
