import { useEffect, useState } from 'react'
import { Ban, Check, MessageCircle, Unplug, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ChannelStatus } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '@/hooks/use-llamarun'
import { errorMessage, relativeTime } from '@/lib/utils'
import { Page, PageHeader, SettingRow } from '../components'

const HOW: Record<ChannelStatus['id'], string> = {
  telegram: 'In Telegram, message @BotFather, send /newbot and follow the steps. It gives you a token: paste it here.',
  discord:
    'In the Discord Developer Portal, create an application, open Bot, turn on Message Content Intent (and Public Bot off) and copy the token. Paste it here; then use Add to a server (any server of yours, even a new empty one) and Message the bot. Slash commands work in the server too: answers come to your direct messages.'
}

const who = (p: { name: string; username?: string; peer: string }): string => `${p.name}${p.username ? ` (@${p.username})` : ''}`

function ChannelCard({ status }: { status: ChannelStatus }) {
  const [token, setToken] = useState('')
  const [peerId, setPeerId] = useState('')
  const [busy, setBusy] = useState(false)
  const act = (p: Promise<unknown>): void => void p.catch((err) => toast.error(errorMessage(err)))

  const connect = (): void => {
    setBusy(true)
    void api.channels
      .connect(status.id, token)
      .then(() => setToken(''))
      .catch((err) => toast.error(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-4" /> {status.label}
          {status.connected ? <Badge>Connected{status.botName ? ` as ${status.botName}` : ''}</Badge> : status.configured ? <Badge variant="destructive">Not connected</Badge> : null}
        </CardTitle>
        <CardDescription>{HOW[status.id]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status.error && <p className="text-xs text-destructive">{status.error}</p>}
        {status.menu && !status.error?.startsWith('Menu:') && <p className="text-xs text-muted-foreground">{status.menu}</p>}
        {status.connected && status.links && status.links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {status.links.map((l) => (
              <Button key={l.url} size="sm" variant="outline" onClick={() => void api.app.openExternal(l.url)}>
                {l.label}
              </Button>
            ))}
          </div>
        )}
        {!status.configured ? (
          <div className="flex gap-2">
            <Input type="password" autoComplete="off" placeholder="Bot token" value={token} onChange={(e) => setToken(e.target.value)} />
            <Button onClick={connect} disabled={!token.trim() || busy}>
              Connect
            </Button>
          </div>
        ) : (
          <>
            {!status.paired.length && !status.pending.length && (
              <p className="text-sm text-muted-foreground">
                Send any message to {status.botName ?? 'your bot'} from your phone. A request shows up here; allow it to start chatting.
              </p>
            )}
            {status.pending.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium">Waiting for you</p>
                {status.pending.map((p) => (
                  <div key={p.peer} className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p>
                        {who(p)} <span className="text-xs text-muted-foreground">· id {p.peer} · {relativeTime(p.at)}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={p.text}>
                        “{p.text}”
                      </p>
                      <p className="text-2xs text-muted-foreground">Only allow it if this is you or someone you trust: they can use your PC through Llama Run.</p>
                    </div>
                    <Button size="sm" onClick={() => act(api.channels.approve(status.id, p.peer))}>
                      <Check /> Allow
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act(api.channels.block(status.id, p.peer))}>
                      <Ban /> Block
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {status.paired.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium">Allowed</p>
                <div className="divide-y rounded-lg border">
                  {status.paired.map((p) => (
                    <div key={p.peer} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex-1">
                        {who(p)} <span className="text-xs text-muted-foreground">· id {p.peer}</span>
                      </span>
                      <Button size="icon-sm" variant="ghost" title="Remove (they can ask again)" onClick={() => act(api.channels.unpair(status.id, p.peer))}>
                        <X />
                      </Button>
                      <Button size="icon-sm" variant="ghost" title="Block" onClick={() => act(api.channels.block(status.id, p.peer))}>
                        <Ban />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {status.blocked.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium">Blocked</p>
                <div className="divide-y rounded-lg border">
                  {status.blocked.map((p) => (
                    <div key={p.peer} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      <span className="flex-1">
                        {who(p)} <span className="text-xs">· id {p.peer}</span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => act(api.channels.unpair(status.id, p.peer))}>
                        Unblock
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Input placeholder={`Allow someone by ${status.label} id`} value={peerId} onChange={(e) => setPeerId(e.target.value)} className="max-w-64" />
              <Button
                variant="outline"
                size="sm"
                disabled={!peerId.trim()}
                onClick={() => act(api.channels.approve(status.id, peerId).then(() => setPeerId('')))}
              >
                <UserPlus /> Allow
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => act(api.channels.disconnect(status.id))}>
              <Unplug /> Disconnect and forget the token
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Talking to Llama Run from Telegram or Discord, through the user's own bot. */
export function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelStatus[]>([])
  useEffect(() => {
    void api.channels.status().then(setChannels)
    return api.on('channels:changed', setChannels)
  }, [])
  const deliver = channels[0]?.deliverRoutines ?? false
  return (
    <Page>
      <PageHeader
        title="Channels"
        description="Message Llama Run from your phone through your own Telegram or Discord bot. Anyone new who messages it waits here until you allow or block them, and nobody can let themselves in. Each allowed person gets their own chat on this PC; approvals come as buttons; computer use stays off. The bot's / menu has /new, /stop, /model, /compact, /usage, /status and your skills. Llama Run has to be running (it lives in the tray)."
      />
      {channels.map((c) => (
        <ChannelCard key={c.id} status={c} />
      ))}
      <Card>
        <CardContent>
          <SettingRow title="Send routine results there too" description="Routine notifications also go to your paired chats.">
            <Switch checked={deliver} onCheckedChange={(v) => void api.channels.setDeliver(v)} />
          </SettingRow>
        </CardContent>
      </Card>
    </Page>
  )
}
