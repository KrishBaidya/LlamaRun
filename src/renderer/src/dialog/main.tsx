import { createRoot } from 'react-dom/client'
import '@/styles.css'
import { applySystemTheme } from '@/lib/utils'
import { DialogApp } from './DialogApp'

applySystemTheme()
createRoot(document.getElementById('root')!).render(<DialogApp />)
