import { useCallback, useEffect, useState } from 'react'
import { Stack, Typography, Button, Paper, Skeleton } from '@mui/material'
import TaskCard from '../components/TaskCard'
import { api } from '../api'
import type { TaskSummary } from '../types'
import { useApiStatus } from '../contexts/apiStatus'
import { Link as RouterLink } from 'react-router-dom'

function TasksPage() {
  const { setStatus } = useApiStatus()
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadTasks = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await api<TaskSummary[]>('/api/tasks')
      setTasks(data)
      setStatus('Ready', 'success')
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
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

  const handleDelete = useCallback(
    async (task: TaskSummary) => {
      if (!window.confirm(`Delete task "${task.title}"?`)) {
        return
      }
      setDeletingId(task.id)
      try {
        await api(`/api/tasks/${task.id}`, { method: 'DELETE' })
        setStatus('Task removed', 'success')
        await loadTasks()
      } catch (err) {
        const message = (err as Error).message
        setStatus(message, 'danger')
        alert(message)
      } finally {
        setDeletingId(null)
      }
    },
    [loadTasks, setStatus],
  )

  return (
    <Paper sx={{ p: { xs: 3, md: 4 } }}>
      <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <div>
          <Typography variant="h5">Tasks</Typography>
          <Typography variant="body2" color="text.secondary">
            Lightweight overview of every automation run.
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
      <Stack spacing={2} mt={3}>
        {isLoading && tasks.length === 0 ? (
          <Skeleton variant="rounded" height={120} />
        ) : tasks.length === 0 ? (
          <Typography color="text.secondary">No tasks yet. Launch one to see it here.</Typography>
        ) : (
          tasks.map((task) => (
            <TaskCard key={task.id} task={task} onDelete={handleDelete} deleting={deletingId === task.id} />
          ))
        )}
      </Stack>
    </Paper>
  )
}

export default TasksPage
