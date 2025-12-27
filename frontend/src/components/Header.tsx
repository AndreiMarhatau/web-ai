import { AppBar, Toolbar, Typography, Stack, Button, Chip, Container, Box, Paper } from '@mui/material'
import { NavLink } from 'react-router-dom'
import { useApiStatus } from '../contexts/apiStatus'

function Header() {
  const { status } = useApiStatus()

  const chipColor =
    status.variant === 'success' ? 'success' : status.variant === 'danger' ? 'error' : 'default'

  return (
    <AppBar position="sticky" color="transparent" elevation={0}>
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between" sx={{ width: '100%' }} spacing={2}>
            <Box>
              <Typography variant="overline" sx={{ letterSpacing: '0.5em', color: 'text.secondary' }}>
                Browser automation
              </Typography>
              <Typography variant="h3" component="h1">
                Web AI Control Room
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Plan, launch, and monitor tasks with a live operational view.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Chip label={status.text} color={chipColor} variant="outlined" sx={{ textTransform: 'uppercase', letterSpacing: '0.18em' }} />
              <Button variant="contained" component={NavLink} to="/tasks/new">
                Launch task
              </Button>
            </Stack>
          </Stack>
          <Paper
            variant="outlined"
            sx={{
              width: '100%',
              px: 1,
              py: 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
              backgroundColor: 'rgba(255, 253, 249, 0.8)',
            }}
          >
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <NavLink to="/" end style={{ textDecoration: 'none' }}>
                {({ isActive }) => (
                  <Button color={isActive ? 'primary' : 'inherit'} variant={isActive ? 'contained' : 'text'}>
                    Tasks
                  </Button>
                )}
              </NavLink>
              <NavLink to="/nodes" style={{ textDecoration: 'none' }}>
                {({ isActive }) => (
                  <Button color={isActive ? 'primary' : 'inherit'} variant={isActive ? 'contained' : 'text'}>
                    Nodes
                  </Button>
                )}
              </NavLink>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Live data refreshes every 5 seconds.
            </Typography>
          </Paper>
        </Toolbar>
      </Container>
    </AppBar>
  )
}

export default Header
