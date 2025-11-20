import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, Link as RouterLink } from 'react-router-dom'
import { Paper, Stack, Typography, TextField, Button, FormControlLabel, Switch, MenuItem, Skeleton, Chip, Alert } from '@mui/material'
import { api } from '../api'
import type { ConfigDefaults, NodeInfo, NodesResponse, TaskDetail } from '../types'
import { useApiStatus } from '../contexts/apiStatus'

const initialFormState = {
  title: '',
  instructions: '',
  model: '',
  reasoningEffort: '',
  maxSteps: 80,
  leaveBrowserOpen: false,
  scheduleEnabled: false,
  scheduledFor: '',
  nodeId: '',
}

function CreateTaskPage() {
  const { setStatus } = useApiStatus()
  const [defaults, setDefaults] = useState<ConfigDefaults | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [headPublicKey, setHeadPublicKey] = useState('')
  const [enrollToken, setEnrollToken] = useState('')
  const [form, setForm] = useState(initialFormState)
  const [loadingDefaults, setLoadingDefaults] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  const loadDefaults = useCallback(async () => {
    setLoadingDefaults(true)
    try {
      const data = await api<ConfigDefaults>('/api/config/defaults')
      setDefaults(data)
      setForm((current) => ({
        ...current,
        model: data.model,
        maxSteps: data.max_steps,
        leaveBrowserOpen: data.leaveBrowserOpen,
        reasoningEffort: '',
        nodeId: data.nodeId || current.nodeId,
      }))
      setStatus('Ready', 'success')
    } catch (err) {
      setStatus((err as Error).message, 'danger')
    } finally {
      setLoadingDefaults(false)
    }
  }, [setStatus])

  useEffect(() => {
    loadDefaults()
  }, [loadDefaults])

  const loadNodes = useCallback(async () => {
    try {
      const data = await api<NodesResponse>('/api/nodes')
      setNodes(data.nodes)
      setHeadPublicKey(data.public_key)
      setEnrollToken(data.enroll_token || '')
      if (data.nodes.length === 1) {
        setForm((current) => ({ ...current, nodeId: data.nodes[0].id }))
      }
    } catch (err) {
      setStatus((err as Error).message, 'danger')
    }
  }, [setStatus])

  useEffect(() => {
    loadNodes()
  }, [loadNodes])

  const handleChange = (field: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...field }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = form.title.trim()
    const instructions = form.instructions.trim()
    if (!title || !instructions) {
      alert('Title and instructions are required.')
      return
    }
    if (form.scheduleEnabled && !form.scheduledFor) {
      alert('Choose when the task should start.')
      return
    }
    if (nodes.length > 1 && !form.nodeId) {
      alert('Select a node to run on.')
      return
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        title,
        instructions,
        model: form.model,
        max_steps: form.maxSteps,
        leave_browser_open: form.leaveBrowserOpen,
      }
      if (form.nodeId) {
        payload.node_id = form.nodeId
      }
      if (form.reasoningEffort) {
        payload.reasoning_effort = form.reasoningEffort
      }
      if (form.scheduleEnabled && form.scheduledFor) {
        const parsed = new Date(form.scheduledFor)
        if (Number.isNaN(parsed.getTime())) {
          throw new Error('Invalid scheduled time.')
        }
        if (parsed.getTime() <= Date.now()) {
          throw new Error('Scheduled time must be in the future.')
        }
        payload.scheduled_for = parsed.toISOString()
      }
      const detail = await api<TaskDetail>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setStatus('Task launched', 'success')
      navigate(`/tasks/${detail.record.id}?node=${detail.record.node_id || form.nodeId || nodes[0]?.id || ''}`)
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      alert(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Paper sx={{ p: { xs: 3, md: 4 } }}>
      <Stack spacing={2} mb={2}>
        <Typography variant="h5">Launch task</Typography>
        <Typography variant="body2" color="text.secondary">
          Define the goal, instructions, and model configuration.
        </Typography>
      </Stack>
      {loadingDefaults && !defaults ? (
        <Skeleton variant="rounded" height={220} />
      ) : (
        <Stack component="form" onSubmit={handleSubmit} spacing={3}>
          <TextField
            label="Title"
            value={form.title}
            onChange={(event) => handleChange({ title: event.target.value })}
            placeholder="Summarize what you want automated"
            required
            fullWidth
          />
          <TextField
            label="Instructions"
            value={form.instructions}
            onChange={(event) => handleChange({ instructions: event.target.value })}
            placeholder="Describe what the agent should accomplish"
            required
            fullWidth
            multiline
            minRows={4}
          />
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.scheduleEnabled}
                  onChange={(event) => handleChange({ scheduleEnabled: event.target.checked })}
                />
              }
              label="Schedule start time"
            />
            {form.scheduleEnabled && (
              <TextField
                type="datetime-local"
                label="Start time"
                value={form.scheduledFor}
                onChange={(event) => handleChange({ scheduledFor: event.target.value })}
                fullWidth
                required
              />
            )}
          </Stack>
          {nodes.length > 1 && (
            <TextField
              select
              label="Node"
              name="node"
              value={form.nodeId}
              onChange={(event) => handleChange({ nodeId: event.target.value })}
              fullWidth
              required
              helperText="Choose where the task should run"
            >
              {nodes.map((node) => (
                <MenuItem key={node.id} value={node.id}>
                  {node.name || node.id}
                </MenuItem>
              ))}
            </TextField>
          )}
          {nodes.length === 1 && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={`Node: ${nodes[0].name || nodes[0].id}`} size="small" />
              <Typography variant="body2" color="text.secondary">
                Tasks will run on this node.
              </Typography>
            </Stack>
          )}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              select
              label="OpenAI model"
              name="model"
              value={form.model}
              onChange={(event) => handleChange({ model: event.target.value })}
              fullWidth
            >
              {defaults?.supportedModels.map((model) => (
                <MenuItem key={model} value={model}>
                  {model}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Reasoning effort"
              name="reasoning_effort"
              value={form.reasoningEffort}
              onChange={(event) => handleChange({ reasoningEffort: event.target.value })}
              fullWidth
            >
              <MenuItem value="">Automatic</MenuItem>
              {defaults?.reasoningEffortOptions?.map((option) => (
                <MenuItem key={option} value={option}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
            <TextField
              label="Max steps"
              type="number"
              inputProps={{ min: 1, max: 200 }}
              value={form.maxSteps}
              onChange={(event) => handleChange({ maxSteps: Number(event.target.value) })}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.leaveBrowserOpen}
                  onChange={(event) => handleChange({ leaveBrowserOpen: event.target.checked })}
                />
              }
              label="Keep browser open after completion"
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button type="submit" variant="contained" disabled={loadingDefaults || submitting}>
              {submitting ? 'Launching…' : 'Launch task'}
            </Button>
            <Button component={RouterLink} to="/" variant="outlined">
              Back to tasks
            </Button>
          </Stack>
          {headPublicKey && (
            <TextField
              label="Head public key"
              value={headPublicKey}
              multiline
              minRows={3}
              fullWidth
              InputProps={{ readOnly: true }}
              helperText="Provide this to nodes so they can verify requests from the head."
            />
          )}
          {enrollToken && (
            <Alert severity="info">
              Enrollment token available: nodes can accept the head key via the head UI without manual copy.
            </Alert>
          )}
        </Stack>
      )}
    </Paper>
  )
}

export default CreateTaskPage
