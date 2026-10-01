import { createRoot } from 'react-dom/client'
import '@/styles.css'
import { applySystemTheme } from '@/lib/utils'
import { HudApp } from './HudApp'

applySystemTheme()
createRoot(document.getElementById('root')!).render(<HudApp />)
