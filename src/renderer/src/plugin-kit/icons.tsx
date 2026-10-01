import {
  AlertTriangle,
  Bell,
  Bot,
  Check,
  ChevronRight,
  Circle,
  Clipboard,
  Clock,
  Copy,
  Download,
  ExternalLink,
  File,
  Folder,
  Globe,
  Heart,
  Info,
  Link,
  List,
  Mic,
  MicOff,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  Square,
  Star,
  Trash2,
  Upload,
  User,
  Volume2,
  VolumeX,
  X,
  Zap,
  type LucideProps
} from 'lucide-react'

type IconComponent = React.ComponentType<LucideProps>

/**
 * Icons Python UI trees can use by name. Panels (TSX) get every Lucide icon:
 * the panel page registers the full set with setIconSet(), which keeps the
 * other windows from loading all of them.
 */
let iconSet: Record<string, IconComponent> = {
  AlertTriangle,
  Bell,
  Bot,
  Check,
  ChevronRight,
  Circle,
  Clipboard,
  Clock,
  Copy,
  Download,
  ExternalLink,
  File,
  Folder,
  Globe,
  Heart,
  Info,
  Link,
  List,
  Mic,
  MicOff,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  Square,
  Star,
  Trash2,
  Upload,
  User,
  Volume2,
  VolumeX,
  X,
  Zap
}

export function setIconSet(icons: Record<string, IconComponent>): void {
  iconSet = { ...iconSet, ...icons }
}

/** Lucide icon by kebab-case name ("trash-2") or PascalCase name ("Trash2"). Unknown names render nothing. */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const key =
    name.includes('-') || name.toLowerCase() === name ? name.replace(/(^|-)([a-z0-9])/g, (_m, _d, c: string) => c.toUpperCase()) : name
  const Component = iconSet[key]
  return Component ? <Component {...props} /> : null
}
