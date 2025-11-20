import { useEffect, useState, useCallback } from 'react'
import { Stack, Typography, Paper, Chip, Button, Skeleton, Alert } from '@mui/material'
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

  const statusChip = (node: NodeInfo) => {
    if (!node.reachable) return <Chip label="Unreachable" color="error" size="small" />
    if (node.ready) return <Chip label="Ready" color="success" size="small" />
    return <Chip label="Attention" color="warning" size="small" />
  }

  return (
    <Paper sx={{ p: { xs: 3, md: 4 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2}>
        <div>
          <Typography variant="h5">Nodes</Typography>
          <Typography variant="body2" color="text.secondary">
            View node health and availability.
          </Typography>
        </div>
        <Button variant="outlined" onClick={() => void loadNodes()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Stack>
      <Stack spacing={2} mt={3}>
        {errors.length > 0 && <Alert severity="warning">{errors.join('; ')}</Alert>}
        {loading && nodes.length === 0 ? (
          <Skeleton variant="rounded" height={120} />
        ) : nodes.length === 0 ? (
          <Typography color="text.secondary">No nodes configured.</Typography>
        ) : (
          nodes.map((node) => (
            <Paper key={node.id} variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle1">{node.name || node.id}</Typography>
                  <Typography variant="body2" color="text.secondary">ID: {node.id}</Typography>
                  <Typography variant="body2" color="text.secondary">URL: {node.url}</Typography>
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
  )
}

export default NodesPage
