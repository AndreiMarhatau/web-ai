import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'

type ApiStatusVariant = 'muted' | 'success' | 'danger'

interface ApiStatusState {
  text: string
  variant: ApiStatusVariant
}

interface ApiStatusContextValue {
  status: ApiStatusState
  setStatus: (text: string, variant?: ApiStatusVariant) => void
}

const ApiStatusContext = createContext<ApiStatusContextValue | undefined>(undefined)

export function ApiStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatusState] = useState<ApiStatusState>({ text: 'Loading…', variant: 'muted' })
  const setStatus = useCallback((text: string, variant: ApiStatusVariant = 'muted') => {
    setStatusState({ text, variant })
  }, [])
  return <ApiStatusContext.Provider value={{ status, setStatus }}>{children}</ApiStatusContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApiStatus() {
  const context = useContext(ApiStatusContext)
  if (!context) {
    throw new Error('useApiStatus must be used within ApiStatusProvider')
  }
  return context
}
