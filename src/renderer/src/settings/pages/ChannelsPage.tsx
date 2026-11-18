import { useEffect, useState } from 'react'
import { MessageCircle, RefreshCw, Unplug, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ChannelStatus } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'
import { Page, PageHeader, SettingRow } from '../components'

const HOW: Record<ChannelStatus['id'], string> = {
  telegram: 'In Telegram, message @BotFather, send /newbot and follow the steps. It gives you a token: paste it here.',
  discord:
    'In the Discord Developer Portal, create an application, add a bot, turn on the Message Content intent and copy the bot token. Invite it to a server you share so you can message it directly.'
}

function ChannelCard({ status }: { status: ChannelStatus }) {
  const [token, setToken] = useState('')
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
        {!status.configured ? (
          <div className="flex gap-2">
            <Input type="password" autoComplete="off" placeholder="Bot token" value={token} onChange={(e) => setToken(e.target.value)} />
            <Button onClick={connect} disabled={!token.trim() || busy}>
              Connect
            </Button>
          </div>
        ) : (
          <>
            {status.pairCode ? (
              <p className="text-sm">
                To pair your account, send <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{status.pairCode}</code> to {status.botName ?? 'the bot'} in {status.label}.
              </p>
            ) : (
              <Button variant="outline" size="sm" className="self-start" onClick={() => act(api.channels.newCode(status.id))}>
                <RefreshCw /> Pair another account
              </Button>
            )}
            {status.paired.length > 0 && (
              <div className="divide-y rounded-lg border">
                {status.paired.map((p) => (
                  <div key={p.peer} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="flex-1">{p.name}</span>
                    <Button size="icon-sm" variant="ghost" title="Unpair" onClick={() => act(api.channels.unpair(status.id, p.peer))}>
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}
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
        description="Message Llama Run from your phone through your own Telegram or Discord bot. Each paired account gets its own chat on this PC; approvals come as buttons; computer use stays off. Llama Run has to be running (it lives in the tray)."
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
