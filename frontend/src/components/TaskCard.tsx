import { Card, CardContent, Stack, Typography, Chip, Button, Divider } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import type { TaskSummary } from '../types'
import { statusTone } from '../utils/status'

interface TaskCardProps {
  task: TaskSummary
  onDelete: (task: TaskSummary) => void
  deleting?: boolean
  nodeName?: string
}

function TaskCard({ task, onDelete, deleting, nodeName }: TaskCardProps) {
  const scheduledLabel = task.scheduled_for ? new Date(task.scheduled_for).toLocaleString() : null
  const nodeLabel = nodeName || task.node_id
  const updatedLabel = new Date(task.updated_at).toLocaleString()
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2}>
            <div>
              <Typography variant="h6">{task.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                Updated {updatedLabel}
              </Typography>
            </div>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={task.status.replace(/_/g, ' ')} color={statusTone(task.status, task.needs_attention)} size="small" />
              {task.needs_attention && <Chip label="Needs input" color="warning" size="small" />}
              {task.browser_open && <Chip label="Browser open" color="success" size="small" />}
            </Stack>
          </Stack>
          <Divider />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`Node: ${nodeLabel}`} size="small" variant="outlined" />
              <Chip label={`Steps: ${task.step_count}`} size="small" variant="outlined" />
              <Chip label={task.model_name} size="small" variant="outlined" />
              {scheduledLabel && (
                <Chip label={`Starts ${scheduledLabel}`} color="warning" size="small" variant="outlined" />
              )}
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button component={RouterLink} to={`/tasks/${task.id}?node=${task.node_id}`} variant="outlined">
                View
              </Button>
              <Button variant="contained" color="error" disabled={deleting} onClick={() => onDelete(task)}>
                {deleting ? 'Removing…' : 'Remove'}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

export default TaskCard
