import { AppBar, Toolbar, Typography, Stack, Button, Chip, Container } from '@mui/material'
import { NavLink } from 'react-router-dom'
import { useApiStatus } from '../contexts/apiStatus'

function Header() {
  const { status } = useApiStatus()

  const chipColor =
    status.variant === 'success' ? 'success' : status.variant === 'danger' ? 'error' : 'default'

  return (
    <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ py: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}>
          <div>
            <Typography variant="overline" sx={{ letterSpacing: '0.4em', color: 'text.secondary' }}>
              Browser automation
            </Typography>
            <Typography variant="h4" component="h1">
              Web AI
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Plan, launch, and monitor tasks without reloads.
            </Typography>
          </div>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Stack direction="row" spacing={1}>
              <NavLink to="/" end style={{ textDecoration: 'none' }}>
                {({ isActive }) => (
                  <Button
                    color="inherit"
                    sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 600, px: 2, opacity: isActive ? 1 : 0.65 }}
                  >
                    Tasks
                  </Button>
                )}
              </NavLink>
              <NavLink to="/tasks/new" style={{ textDecoration: 'none' }}>
                {({ isActive }) => (
                  <Button
                    color="inherit"
                    sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 600, px: 2, opacity: isActive ? 1 : 0.65 }}
                  >
                    Launch task
                  </Button>
                )}
              </NavLink>
              <NavLink to="/nodes" style={{ textDecoration: 'none' }}>
                {({ isActive }) => (
                  <Button
                    color="inherit"
                    sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 600, px: 2, opacity: isActive ? 1 : 0.65 }}
                  >
                    Nodes
                  </Button>
                )}
              </NavLink>
            </Stack>
            <Chip label={status.text} color={chipColor} variant="outlined" sx={{ textTransform: 'uppercase', letterSpacing: '0.15em' }} />
          </Stack>
        </Toolbar>
      </Container>
    </AppBar>
  )
}

export default Header
