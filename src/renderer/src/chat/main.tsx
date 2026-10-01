import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'
import { applySystemTheme } from '@/lib/utils'
import { ChatApp } from './ChatApp'

applySystemTheme()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>
)
