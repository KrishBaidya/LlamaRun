import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'
import { applySystemTheme } from '@/lib/utils'
import { OnboardingApp } from './OnboardingApp'

applySystemTheme()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OnboardingApp />
  </StrictMode>
)
