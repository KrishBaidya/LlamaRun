import { useCallback } from 'react'
import { createHashRouter, NavLink, Outlet, RouterProvider, useNavigate } from 'react-router'
import { AlarmClock, Blocks, Boxes, Brain, MessageCircle, Webhook, Home, LogIn, LogOut, MessagesSquare, MousePointerClick, Plug, Sparkles } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, useIpcEvent, useProfile } from '@/hooks/use-llamarun'
import { usePluginSurfaces } from '@/hooks/use-plugin-surfaces'
import { Icon as PluginIcon } from '@/plugin-kit/icons'
import { cn } from '@/lib/utils'
import { TitleBar } from '@/components/TitleBar'
import { ChannelsPage } from './pages/ChannelsPage'
import { ComputerPage } from './pages/ComputerPage'
import { HooksPage } from './pages/HooksPage'
import { HomePage } from './pages/HomePage'
import { PluginDetailsPage } from './pages/PluginDetailsPage'
import { PluginPage } from './pages/PluginPage'
import { PluginsPage } from './pages/PluginsPage'
import { McpPage } from './pages/McpPage'
import { ModelsPage } from './pages/ModelsPage'
import { McpServerDetailsPage } from './pages/McpServerDetailsPage'
import { MemoryPage } from './pages/MemoryPage'
import { RoutinesPage } from './pages/RoutinesPage'
import { SkillsPage } from './pages/SkillsPage'
import { toast } from 'sonner'

const NAV_LINK =
  'flex h-8 items-center gap-2.5 rounded-control px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-row-hover [&>svg]:text-sidebar-muted-foreground'

/** Pages plugins added to Settings (SDK 1.6), under a heading of their own. */
function PluginPagesNav() {
  const { settingsPages } = usePluginSurfaces()
  if (!settingsPages.length) return null
  return (
    <>
      <div className="px-2.5 pt-3 pb-1 text-2xs font-medium text-sidebar-muted-foreground">From plugins</div>
      {settingsPages.map((p) => (
        <NavLink
          key={`${p.plugin}:${p.id}`}
          to={`/plugin-page/${encodeURIComponent(p.plugin)}/${encodeURIComponent(p.id)}`}
          title={`${p.title} (${p.pluginName})`}
          className={({ isActive }) => cn(NAV_LINK, isActive && 'bg-sidebar-row-selected font-medium shadow-xs')}
        >
          {p.icon ? <PluginIcon name={p.icon} className="size-4" /> : <Blocks className="size-4" />}
          <span className="min-w-0 truncate">{p.title}</span>
        </NavLink>
      ))}
    </>
  )
}

const NAV = [
  { to: '/', label: 'General', icon: Home, end: true },
  { to: '/models', label: 'Models', icon: Boxes, end: false },
  { to: '/memory', label: 'Memory', icon: Brain, end: false },
  { to: '/skills', label: 'Skills', icon: Sparkles, end: false },
  { to: '/routines', label: 'Routines', icon: AlarmClock, end: false },
  { to: '/hooks', label: 'Hooks', icon: Webhook, end: false },
  { to: '/channels', label: 'Channels', icon: MessageCircle, end: false },
  { to: '/computer', label: 'Computer use', icon: MousePointerClick, end: false },
  { to: '/plugins', label: 'Plugins', icon: Blocks, end: false },
  { to: '/mcp', label: 'MCP Servers', icon: Plug, end: false }
]

function UserCard() {
  const profile = useProfile()
  if (!profile) return null
  if (!profile.signedIn) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <p className="text-2xs text-muted-foreground">Sign in to use cloud models like Gemini and OpenAI. Free plan included.</p>
        <Button className="w-full" size="sm" onClick={() => void api.auth.signIn()}>
          <LogIn /> Sign In
        </Button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card p-2">
      <Avatar className="size-8">
        {profile.photoURL && <AvatarImage src={profile.photoURL} alt="" />}
        <AvatarFallback>{profile.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{profile.name}</span>
          {profile.plan && (
            <Badge variant={profile.plan.tier === 'pro' ? 'default' : 'secondary'} className="px-1.5 py-0 text-2xs">
              {profile.plan.tier === 'pro' ? 'Pro' : 'Free'}
            </Badge>
          )}
        </div>
        <div className="truncate text-2xs text-muted-foreground">{profile.email || 'Signed in'}</div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        title="Sign out"
        onClick={() => void api.auth.signOut().then(() => toast.success('Signed out'))}
      >
        <LogOut />
      </Button>
    </div>
  )
}

function Layout() {
  const navigate = useNavigate()
  useIpcEvent(
    'settings:navigate',
    useCallback((route: string) => void navigate(route), [navigate])
  )

  return (
    <TooltipProvider>
      <div className="flex h-full">
        <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
          <TitleBar className="pe-3">
            <span className="text-sm font-semibold tracking-tight">Settings</span>
          </TitleBar>
          <nav className="flex flex-col gap-px px-2">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex h-8 items-center gap-2.5 rounded-control px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-row-hover [&>svg]:text-sidebar-muted-foreground',
                    isActive && 'bg-sidebar-row-selected font-medium shadow-xs'
                  )
                }
              >
                <Icon className="size-4" /> {label}
              </NavLink>
            ))}
            <button
              onClick={() => void api.app.openChat()}
              className="flex h-8 items-center gap-2.5 rounded-control px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-row-hover [&>svg]:text-sidebar-muted-foreground"
            >
              <MessagesSquare className="size-4" /> Chats
            </button>
            <PluginPagesNav />
          </nav>
          <div className="mt-auto p-2">
            <UserCard />
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <TitleBar />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </main>
      </div>
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  )
}

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'models', element: <ModelsPage /> },
      { path: 'memory', element: <MemoryPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'routines', element: <RoutinesPage /> },
      { path: 'hooks', element: <HooksPage /> },
      { path: 'channels', element: <ChannelsPage /> },
      { path: 'computer', element: <ComputerPage /> },
      { path: 'plugins', element: <PluginsPage /> },
      { path: 'plugins/:id', element: <PluginDetailsPage /> },
      { path: 'plugin-page/:plugin/:page', element: <PluginPage /> },
      { path: 'mcp', element: <McpPage /> },
      { path: 'mcp/server/:id', element: <McpServerDetailsPage /> }
    ]
  }
])

export function SettingsApp() {
  return <RouterProvider router={router} />
}
