import { useCallback, useEffect, useMemo, useState } from 'react'
import { Stack, Typography, Button, Paper, Skeleton, Alert, TextField, MenuItem, InputAdornment, Box } from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import TaskCard from '../components/TaskCard'
import { api } from '../api'
import type { NodeInfo, NodesResponse, TaskListResponse, TaskSummary } from '../types'
import { useApiStatus } from '../contexts/apiStatus'
import { Link as RouterLink } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'

function TasksPage() {
  const { setStatus } = useApiStatus()
  const [tasks, setTasks] = useState<TaskListResponse['tasks']>([])
  const [taskErrors, setTaskErrors] = useState<TaskListResponse['errors']>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TaskSummary | null>(null)

  const nodeNameMap = useMemo(() => {
    return nodes.reduce<Record<string, string>>((acc, node) => {
      acc[node.id] = node.name || node.id
      return acc
    }, {})
  }, [nodes])

  const loadNodes = useCallback(async () => {
    try {
      const data = await api<NodesResponse>('/api/nodes')
      setNodes(data.nodes || [])
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
    }
  }, [setStatus])

  const loadTasks = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await api<TaskListResponse>('/api/tasks')
      setTasks(data.tasks || [])
      setTaskErrors(data.errors || [])
      setFeedback(null)
      if (data.errors && data.errors.length > 0) {
        setStatus('Some nodes unavailable', 'danger')
      } else {
        setStatus('Ready', 'success')
      }
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setFeedback(message)
    } finally {
      setRefreshing(false)
      setIsLoading(false)
    }
  }, [setStatus])

  useEffect(() => {
    loadTasks()
    const timer = setInterval(() => {
      loadTasks()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadTasks])

  useEffect(() => {
    loadNodes()
  }, [loadNodes])

  const handleDelete = useCallback(
    async (task: TaskSummary) => {
      setDeletingId(task.id)
      try {
        await api(`/api/tasks/${task.id}?node_id=${task.node_id}`, { method: 'DELETE' })
        setStatus('Task removed', 'success')
        setFeedback(null)
        await loadTasks()
      } catch (err) {
        const message = (err as Error).message
        setStatus(message, 'danger')
        setFeedback(message)
      } finally {
        setDeletingId(null)
      }
    },
    [loadTasks, setStatus],
  )

  const statusOptions = useMemo(() => {
    const uniqueStatuses = new Set(tasks.map((task) => task.status))
    return Array.from(uniqueStatuses).sort()
  }, [tasks])

  const filteredTasks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return tasks.filter((task) => {
      const matchesStatus = statusFilter === 'all' || task.status === statusFilter
      const nodeLabel = nodeNameMap[task.node_id] || task.node_id
      const matchesQuery =
        !query ||
        task.title.toLowerCase().includes(query) ||
        task.model_name.toLowerCase().includes(query) ||
        nodeLabel.toLowerCase().includes(query)
      return matchesStatus && matchesQuery
    })
  }, [nodeNameMap, searchTerm, statusFilter, tasks])

  const stats = useMemo(() => {
    const total = tasks.length
    const running = tasks.filter((task) => task.status === 'running').length
    const needsAttention = tasks.filter((task) => task.needs_attention).length
    const scheduled = tasks.filter((task) => task.status === 'scheduled').length
    return { total, running, needsAttention, scheduled }
  }, [tasks])

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: { xs: 3, md: 4 } }}>
        <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <div>
            <Typography variant="h5">Tasks overview</Typography>
            <Typography variant="body2" color="text.secondary">
              Track every automation run and act quickly when attention is needed.
            </Typography>
          </div>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => void loadTasks()} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button variant="contained" component={RouterLink} to="/tasks/new">
              Launch task
            </Button>
          </Stack>
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            mt: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          }}
        >
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Total tasks
            </Typography>
            <Typography variant="h4">{stats.total}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Running now
            </Typography>
            <Typography variant="h4">{stats.running}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Needs input
            </Typography>
            <Typography variant="h4">{stats.needsAttention}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Scheduled
            </Typography>
            <Typography variant="h4">{stats.scheduled}</Typography>
          </Paper>
        </Box>
      </Paper>

      <Paper sx={{ p: { xs: 3, md: 4 } }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
            <TextField
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by title, node, or model"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: { xs: '100%', md: 320 } }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="all">All statuses</MenuItem>
                {statusOptions.map((status) => (
                  <MenuItem key={status} value={status}>
                    {status.replace(/_/g, ' ')}
                  </MenuItem>
                ))}
              </TextField>
              <Button variant="outlined" onClick={() => void loadTasks()} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </Stack>
          </Stack>
          {feedback && <Alert severity="error">{feedback}</Alert>}
          {taskErrors && taskErrors.length > 0 && (
            <Alert severity="warning">
              Some nodes could not be reached:{' '}
              {taskErrors.map((err) => `${err.node_id}: ${err.detail}`).join('; ')}
            </Alert>
          )}
          {isLoading && tasks.length === 0 ? (
            <Skeleton variant="rounded" height={160} />
          ) : filteredTasks.length === 0 ? (
            <Typography color="text.secondary">No tasks match the current filters.</Typography>
          ) : (
            <Stack spacing={2}>
              {filteredTasks.map((task) => (
                <TaskCard
                  key={`${task.node_id}-${task.id}`}
                  task={task}
                  onDelete={setPendingDelete}
                  deleting={deletingId === task.id}
                  nodeName={nodeNameMap[task.node_id]}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove task"
        description={
          pendingDelete
            ? `Remove "${pendingDelete.title}"? This will delete the task record from the node.`
            : 'Remove this task?'
        }
        confirmLabel="Remove task"
        confirmColor="error"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            void handleDelete(pendingDelete)
            setPendingDelete(null)
          }
        }}
      />
    </Stack>
  )
}

export default TasksPage
