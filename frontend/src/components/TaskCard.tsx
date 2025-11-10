import { Card, CardContent, Stack, Typography, Chip, Button } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import type { TaskSummary } from '../types'
import { statusTone } from '../utils/status'

interface TaskCardProps {
  task: TaskSummary
  onDelete: (task: TaskSummary) => void
  deleting?: boolean
}

function TaskCard({ task, onDelete, deleting }: TaskCardProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <div>
            <Typography variant="h6" gutterBottom>
              {task.title}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={task.status} color={statusTone(task.status, task.needs_attention)} size="small" />
              {task.browser_open && <Chip label="Browser open" color="success" size="small" variant="outlined" />}
              {task.needs_attention && <Chip label="Needs input" color="warning" size="small" variant="outlined" />}
              <Chip label={`Steps: ${task.step_count}`} size="small" variant="outlined" />
              <Chip label={task.model_name} size="small" variant="outlined" />
            </Stack>
          </div>
          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to={`/tasks/${task.id}`} variant="outlined">
              View
            </Button>
            <Button variant="contained" color="error" disabled={deleting} onClick={() => onDelete(task)}>
              {deleting ? 'Removing…' : 'Remove'}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

export default TaskCard
