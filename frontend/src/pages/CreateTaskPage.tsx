import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, Link as RouterLink } from 'react-router-dom'
import { Paper, Stack, Typography, TextField, Button, FormControlLabel, Switch, MenuItem, Skeleton, Chip, Card, CardHeader, CardContent, Alert, Box } from '@mui/material'
import { api } from '../api'
import type { ConfigDefaults, NodeInfo, NodesResponse, TaskDetail } from '../types'
import { useApiStatus } from '../contexts/apiStatus'

const initialFormState = {
  title: '',
  instructions: '',
  model: '',
  customModel: '',
  reasoningEffort: '',
  customReasoningEffort: '',
  maxSteps: 80,
  leaveBrowserOpen: false,
  scheduleEnabled: false,
  scheduledFor: '',
  nodeId: '',
}

const CUSTOM_MODEL_VALUE = '__custom__'
const CUSTOM_REASONING_VALUE = '__custom__'

function CreateTaskPage() {
  const { setStatus } = useApiStatus()
  const [defaults, setDefaults] = useState<ConfigDefaults | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [headPublicKey, setHeadPublicKey] = useState('')
  const [form, setForm] = useState(initialFormState)
  const [loadingDefaults, setLoadingDefaults] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const navigate = useNavigate()

  const resolveDefaultModel = (data: ConfigDefaults) => {
    const supported = data.supportedModels || []
    if (supported.includes(data.model)) {
      return { model: data.model, customModel: '' }
    }
    return { model: CUSTOM_MODEL_VALUE, customModel: data.model }
  }

  const selectedModel = form.model === CUSTOM_MODEL_VALUE ? form.customModel.trim() : form.model
  const reasoningOptions = useMemo(() => {
    return (
      defaults?.reasoningEffortOptionsByModel?.[selectedModel] ??
      defaults?.reasoningEffortOptions ??
      []
    )
  }, [defaults?.reasoningEffortOptions, defaults?.reasoningEffortOptionsByModel, selectedModel])

  const loadDefaults = useCallback(async () => {
    setLoadingDefaults(true)
    try {
      const data = await api<ConfigDefaults>('/api/config/defaults')
      const resolvedModel = resolveDefaultModel(data)
      setDefaults(data)
      setForm((current) => ({
        ...current,
        model: resolvedModel.model,
        customModel: resolvedModel.customModel,
        maxSteps: data.max_steps,
        leaveBrowserOpen: data.leaveBrowserOpen,
        reasoningEffort: '',
        customReasoningEffort: '',
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

  useEffect(() => {
    if (!form.reasoningEffort || form.reasoningEffort === CUSTOM_REASONING_VALUE) {
      return
    }
    if (reasoningOptions.length === 0) {
      return
    }
    if (!reasoningOptions.includes(form.reasoningEffort)) {
      setForm((current) => ({ ...current, reasoningEffort: '' }))
    }
  }, [form.reasoningEffort, reasoningOptions])

  const handleChange = (field: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...field }))
    setFormError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const title = form.title.trim()
    const instructions = form.instructions.trim()
    const resolvedModel =
      form.model === CUSTOM_MODEL_VALUE ? form.customModel.trim() : form.model.trim()
    const resolvedReasoningEffort =
      form.reasoningEffort === CUSTOM_REASONING_VALUE
        ? form.customReasoningEffort.trim()
        : form.reasoningEffort.trim()
    if (!title || !instructions) {
      setFormError('Title and instructions are required.')
      return
    }
    if (!resolvedModel) {
      setFormError('Select or enter a model.')
      return
    }
    if (form.reasoningEffort === CUSTOM_REASONING_VALUE && !resolvedReasoningEffort) {
      setFormError('Enter a custom reasoning effort.')
      return
    }
    if (form.scheduleEnabled && !form.scheduledFor) {
      setFormError('Choose when the task should start.')
      return
    }
    if (nodes.length > 1 && !form.nodeId) {
      setFormError('Select a node to run on.')
      return
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        title,
        instructions,
        model: resolvedModel,
        max_steps: form.maxSteps,
        leave_browser_open: form.leaveBrowserOpen,
      }
      if (form.nodeId) {
        payload.node_id = form.nodeId
      }
      if (resolvedReasoningEffort) {
        payload.reasoning_effort = resolvedReasoningEffort
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
      setFormError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Paper sx={{ p: { xs: 3, md: 4 } }}>
      <Stack spacing={2} mb={3}>
        <Typography variant="h5">Launch a new task</Typography>
        <Typography variant="body2" color="text.secondary">
          Set the mission, configure the model, and pick where it runs.
        </Typography>
      </Stack>
      {loadingDefaults && !defaults ? (
        <Skeleton variant="rounded" height={320} />
      ) : (
        <Stack component="form" onSubmit={handleSubmit} spacing={3}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Card>
            <CardHeader title="Task basics" subheader="Define what should happen and how it should be described." />
            <CardContent>
              <Stack spacing={2}>
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
              </Stack>
            </CardContent>
          </Card>

          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
            }}
          >
            <Card>
              <CardHeader title="Schedule" subheader="Optional start time for this run." />
              <CardContent>
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
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="Execution" subheader="Control how long the agent can run." />
              <CardContent>
                <Stack spacing={2}>
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
              </CardContent>
            </Card>
          </Box>

          <Card>
            <CardHeader title="Model configuration" subheader="Choose a model and its reasoning budget." />
            <CardContent>
              <Stack spacing={2}>
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
                    <MenuItem value={CUSTOM_MODEL_VALUE}>Custom…</MenuItem>
                  </TextField>
                  <TextField
                    select
                    label="Reasoning effort"
                    name="reasoning_effort"
                    value={form.reasoningEffort}
                    onChange={(event) =>
                      handleChange({
                        reasoningEffort: event.target.value,
                        customReasoningEffort:
                          event.target.value === CUSTOM_REASONING_VALUE ? form.customReasoningEffort : '',
                      })
                    }
                    fullWidth
                  >
                    <MenuItem value="">Automatic</MenuItem>
                    {reasoningOptions.map((option) => (
                      <MenuItem key={option} value={option}>
                        {option.charAt(0).toUpperCase() + option.slice(1)}
                      </MenuItem>
                    ))}
                    <MenuItem value={CUSTOM_REASONING_VALUE}>Custom…</MenuItem>
                  </TextField>
                </Stack>
                {form.model === CUSTOM_MODEL_VALUE && (
                  <TextField
                    label="Custom model"
                    value={form.customModel}
                    onChange={(event) => handleChange({ customModel: event.target.value })}
                    placeholder="e.g. gpt-5.2"
                    fullWidth
                    required
                  />
                )}
                {form.reasoningEffort === CUSTOM_REASONING_VALUE && (
                  <TextField
                    label="Custom reasoning effort"
                    value={form.customReasoningEffort}
                    onChange={(event) => handleChange({ customReasoningEffort: event.target.value })}
                    placeholder="e.g. low"
                    fullWidth
                    required
                  />
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Target node" subheader="Select where this run should execute." />
            <CardContent>
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
            </CardContent>
          </Card>

          {headPublicKey && nodes.length > 1 && (
            <Card>
              <CardHeader title="Security" subheader="Reference keys for the cluster." />
              <CardContent>
                <TextField
                  label="Head public key"
                  value={headPublicKey}
                  multiline
                  minRows={3}
                  fullWidth
                  InputProps={{ readOnly: true }}
                  helperText="Head key (for reference only)."
                />
              </CardContent>
            </Card>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button type="submit" variant="contained" disabled={loadingDefaults || submitting}>
              {submitting ? 'Launching…' : 'Launch task'}
            </Button>
            <Button component={RouterLink} to="/" variant="outlined">
              Back to tasks
            </Button>
          </Stack>
        </Stack>
      )}
    </Paper>
  )
}

export default CreateTaskPage
