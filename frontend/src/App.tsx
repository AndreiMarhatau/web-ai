import { CssBaseline, ThemeProvider, createTheme, responsiveFontSizes, Box, Container } from '@mui/material'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import TasksPage from './pages/TasksPage'
import CreateTaskPage from './pages/CreateTaskPage'
import TaskDetailPage from './pages/TaskDetailPage'
import NodesPage from './pages/NodesPage'
import { ApiStatusProvider } from './contexts/apiStatus'

let theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0f766e',
    },
    secondary: {
      main: '#f97316',
    },
    background: {
      default: '#f6f1ea',
      paper: '#fffdf9',
    },
    text: {
      primary: '#1f2933',
      secondary: '#5d6b6f',
    },
    divider: 'rgba(15, 23, 42, 0.12)',
  },
  typography: {
    fontFamily: '"Sora", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontWeight: 600, fontFamily: '"Fraunces", "Sora", serif' },
    h2: { fontWeight: 600, fontFamily: '"Fraunces", "Sora", serif' },
    h3: { fontWeight: 600, fontFamily: '"Fraunces", "Sora", serif' },
    h4: { fontWeight: 600, fontFamily: '"Fraunces", "Sora", serif' },
    h5: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
          backdropFilter: 'blur(8px)',
          backgroundColor: 'rgba(246, 241, 234, 0.78)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          border: '1px solid rgba(15, 23, 42, 0.08)',
          boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid rgba(15, 23, 42, 0.08)',
          boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
        },
      },
    },
  },
})

theme = responsiveFontSizes(theme)

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ApiStatusProvider>
        <BrowserRouter>
          <Box
            sx={{
              minHeight: '100vh',
              background: 'linear-gradient(135deg, #f6f1ea 0%, #f7efe2 40%, #eef4f6 100%)',
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                width: 520,
                height: 520,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(15, 118, 110, 0.18), transparent 70%)',
                top: -180,
                right: -160,
              },
              '&::after': {
                content: '""',
                position: 'absolute',
                width: 420,
                height: 420,
                borderRadius: '30%',
                background: 'radial-gradient(circle, rgba(249, 115, 22, 0.2), transparent 70%)',
                bottom: -160,
                left: -120,
              },
            }}
          >
            <Box sx={{ position: 'relative', zIndex: 1 }}>
              <Header />
              <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
                <Routes>
                  <Route path="/" element={<TasksPage />} />
                  <Route path="/tasks/new" element={<CreateTaskPage />} />
                  <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
                  <Route path="/nodes" element={<NodesPage />} />
                  <Route path="*" element={<TasksPage />} />
                </Routes>
              </Container>
            </Box>
          </Box>
        </BrowserRouter>
      </ApiStatusProvider>
    </ThemeProvider>
  )
}

export default App
