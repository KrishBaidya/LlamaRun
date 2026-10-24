import { createRoot } from 'react-dom/client'
import '@/styles.css'
import { applySystemTheme } from '@/lib/utils'
import { ModelMenuApp } from './ModelMenuApp'

applySystemTheme()
createRoot(document.getElementById('root')!).render(<ModelMenuApp />)
