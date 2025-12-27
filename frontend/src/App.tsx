import { useEffect, useMemo, useState } from 'react'
import { CssBaseline, ThemeProvider, createTheme, responsiveFontSizes, Box, Container } from '@mui/material'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import TasksPage from './pages/TasksPage'
import CreateTaskPage from './pages/CreateTaskPage'
import TaskDetailPage from './pages/TaskDetailPage'
import NodesPage from './pages/NodesPage'
import { ApiStatusProvider } from './contexts/apiStatus'

const THEME_STORAGE_KEY = 'webai-theme'

function App() {
  const [mode, setMode] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') {
      return 'light'
    }
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') {
      return saved
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
    document.documentElement.dataset.theme = mode
  }, [mode])

  const theme = useMemo(() => {
    const isDark = mode === 'dark'
    let nextTheme = createTheme({
      palette: {
        mode,
        primary: {
          main: isDark ? '#22d3ee' : '#0f766e',
        },
        secondary: {
          main: isDark ? '#f97316' : '#f97316',
        },
        background: {
          default: isDark ? '#0f172a' : '#f6f1ea',
          paper: isDark ? '#111827' : '#fffdf9',
        },
        text: {
          primary: isDark ? '#e6edf3' : '#1f2933',
          secondary: isDark ? '#9aa6b2' : '#5d6b6f',
        },
        divider: isDark ? 'rgba(148, 163, 184, 0.18)' : 'rgba(15, 23, 42, 0.12)',
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
              borderBottom: isDark ? '1px solid rgba(148, 163, 184, 0.14)' : '1px solid rgba(15, 23, 42, 0.08)',
              backdropFilter: 'blur(8px)',
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(246, 241, 234, 0.78)',
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              border: isDark ? '1px solid rgba(148, 163, 184, 0.16)' : '1px solid rgba(15, 23, 42, 0.08)',
              boxShadow: isDark ? '0 18px 40px rgba(2, 6, 23, 0.45)' : '0 18px 40px rgba(15, 23, 42, 0.08)',
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              border: isDark ? '1px solid rgba(148, 163, 184, 0.16)' : '1px solid rgba(15, 23, 42, 0.08)',
              boxShadow: isDark ? '0 18px 40px rgba(2, 6, 23, 0.45)' : '0 18px 40px rgba(15, 23, 42, 0.08)',
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

    nextTheme = responsiveFontSizes(nextTheme)
    return nextTheme
  }, [mode])

  const isDark = mode === 'dark'

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ApiStatusProvider>
        <BrowserRouter>
          <Box
            sx={{
              minHeight: '100vh',
              background: isDark
                ? 'linear-gradient(135deg, #0b1120 0%, #0f172a 45%, #111827 100%)'
                : 'linear-gradient(135deg, #f6f1ea 0%, #f7efe2 40%, #eef4f6 100%)',
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                width: 520,
                height: 520,
                borderRadius: '50%',
                background: isDark
                  ? 'radial-gradient(circle, rgba(34, 211, 238, 0.18), transparent 70%)'
                  : 'radial-gradient(circle, rgba(15, 118, 110, 0.18), transparent 70%)',
                top: -180,
                right: -160,
              },
              '&::after': {
                content: '""',
                position: 'absolute',
                width: 420,
                height: 420,
                borderRadius: '30%',
                background: isDark
                  ? 'radial-gradient(circle, rgba(249, 115, 22, 0.18), transparent 70%)'
                  : 'radial-gradient(circle, rgba(249, 115, 22, 0.2), transparent 70%)',
                bottom: -160,
                left: -120,
              },
            }}
          >
            <Box sx={{ position: 'relative', zIndex: 1 }}>
              <Header mode={mode} onToggleMode={() => setMode((prev) => (prev === 'dark' ? 'light' : 'dark'))} />
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
