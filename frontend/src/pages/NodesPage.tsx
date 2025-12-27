import { useEffect, useState, useCallback, useMemo } from 'react'
import { Stack, Typography, Paper, Chip, Button, Skeleton, Alert, Box } from '@mui/material'
import { api } from '../api'
import type { NodeInfo, NodesResponse } from '../types'
import { useApiStatus } from '../contexts/apiStatus'

function NodesPage() {
  const { setStatus } = useApiStatus()
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])

  const loadNodes = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<NodesResponse>('/api/nodes')
      setNodes(data.nodes || [])
      setStatus('Nodes loaded', 'success')
      setErrors([])
    } catch (err) {
      const message = (err as Error).message
      setStatus(message, 'danger')
      setErrors([message])
    } finally {
      setLoading(false)
    }
  }, [setStatus])

  useEffect(() => {
    loadNodes()
  }, [loadNodes])

  const stats = useMemo(() => {
    const total = nodes.length
    const ready = nodes.filter((node) => node.ready).length
    const unreachable = nodes.filter((node) => node.reachable === false).length
    const attention = nodes.filter((node) => node.reachable && !node.ready).length
    return { total, ready, unreachable, attention }
  }, [nodes])

  const statusChip = (node: NodeInfo) => {
    if (!node.reachable) return <Chip label="Unreachable" color="error" size="small" />
    if (node.ready) return <Chip label="Ready" color="success" size="small" />
    return <Chip label="Attention" color="warning" size="small" />
  }

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: { xs: 3, md: 4 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2}>
          <div>
            <Typography variant="h5">Nodes</Typography>
            <Typography variant="body2" color="text.secondary">
              View node health, readiness, and enrollment status.
            </Typography>
          </div>
          <Button variant="outlined" onClick={() => void loadNodes()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
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
              Total nodes
            </Typography>
            <Typography variant="h4">{stats.total}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Ready
            </Typography>
            <Typography variant="h4">{stats.ready}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Attention
            </Typography>
            <Typography variant="h4">{stats.attention}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Unreachable
            </Typography>
            <Typography variant="h4">{stats.unreachable}</Typography>
          </Paper>
        </Box>
      </Paper>

      <Paper sx={{ p: { xs: 3, md: 4 } }}>
        <Stack spacing={2}>
          {errors.length > 0 && <Alert severity="warning">{errors.join('; ')}</Alert>}
          {loading && nodes.length === 0 ? (
            <Skeleton variant="rounded" height={160} />
          ) : nodes.length === 0 ? (
            <Typography color="text.secondary">No nodes configured.</Typography>
          ) : (
            nodes.map((node) => (
              <Paper key={node.id} variant="outlined" sx={{ p: 2.5 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }}>
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle1">{node.name || node.id}</Typography>
                    <Typography variant="body2" color="text.secondary">ID: {node.id}</Typography>
                    {node.url && (
                      <Typography variant="body2" color="text.secondary">
                        URL: {node.url}
                      </Typography>
                    )}
                    {node.issues && node.issues.length > 0 && (
                      <Typography variant="body2" color="warning.main">
                        Issues: {node.issues.join(', ')}
                      </Typography>
                    )}
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {statusChip(node)}
                    {node.enrollment && !node.ready && <Chip label="Enrollment enabled" size="small" />}
                  </Stack>
                </Stack>
              </Paper>
            ))
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}

export default NodesPage
