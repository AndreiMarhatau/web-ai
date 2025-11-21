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
    mode: 'dark',
    primary: {
      main: '#a855f7',
    },
    secondary: {
      main: '#06b6d4',
    },
    background: {
      default: '#05060d',
      paper: 'rgba(15,18,30,0.92)',
    },
  },
  typography: {
    fontFamily: '"Space Grotesk", "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontWeight: 600 },
    h2: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 18,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          border: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 25px 70px rgba(2,6,23,0.65)',
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
              background: 'radial-gradient(circle at 10% 20%, rgba(14,165,233,0.15), transparent 45%), radial-gradient(circle at 80% 0%, rgba(167,139,250,0.25), transparent 40%), #05060d',
            }}
          >
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
        </BrowserRouter>
      </ApiStatusProvider>
    </ThemeProvider>
  )
}

export default App
