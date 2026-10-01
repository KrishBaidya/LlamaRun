import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as JsxRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { icons } from 'lucide-react'
import '@/styles.css'
import * as UiKit from '@/plugin-kit/exports'
import { setIconSet } from '@/plugin-kit/icons'
import { applySystemTheme } from '@/lib/utils'
import { PluginViewApp } from './PluginViewApp'
import * as Runtime from './runtime'

// Modules a compiled panel bundle imports (see src/main/plugins/ui/compile.ts).
Object.assign(window, {
  __llamarun: {
    react: React,
    'react/jsx-runtime': JsxRuntime,
    'react-dom': ReactDOM,
    '@llamarun/ui': UiKit,
    '@llamarun/plugin': Runtime
  }
})

setIconSet(icons)
applySystemTheme()
createRoot(document.getElementById('root')!).render(<PluginViewApp />)
