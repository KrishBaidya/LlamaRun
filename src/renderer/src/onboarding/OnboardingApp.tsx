import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, FileCode2, LoaderCircle, LogIn, WifiOff } from 'lucide-react'
import { DEFAULT_HOTKEY } from '@shared/constants'
import type { UserProfile } from '@shared/types'
import { Button } from '@/components/ui/button'
import { api, useIpcEvent } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'
import { Keycaps } from '../settings/HotkeyRecorder'

function Step({ visual, title, children }: { visual: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-12 text-center">
      <div className="animate-in fade-in slide-in-from-bottom-5 duration-500">{visual}</div>
      <div className="animate-in fade-in slide-in-from-bottom-5 space-y-3 delay-100 duration-500 fill-mode-both">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mx-auto max-w-lg text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

function ConnectStep({ onFinish }: { onFinish: (mode: 'signin' | 'skip') => void }) {
  const [waiting, setWaiting] = useState(false)

  useIpcEvent(
    'auth:changed',
    useCallback(
      (p: UserProfile) => {
        if (waiting && p.signedIn) onFinish('signin')
      },
      [waiting, onFinish]
    )
  )

  return (
    <Step
      title="Connect Your Account"
      visual={
        <div className="flex size-28 items-center justify-center rounded-3xl bg-gradient-to-br from-[#ff00cc]/80 to-[#333399]/80 text-white shadow-xl">
          <LogIn className="size-12" />
        </div>
      }
    >
      <p>Sign in to use cloud models like Gemini and GPT, or skip and use local models through Ollama.</p>
      <div className="mt-8 flex flex-col items-center gap-3">
        {waiting ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" /> Waiting for browser…
            </div>
            <Button variant="ghost" size="sm" onClick={() => setWaiting(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <Button
              size="lg"
              className="w-72"
              onClick={() => {
                setWaiting(true)
                void api.auth.signIn()
              }}
            >
              <LogIn /> Sign In / Create Account
            </Button>
            <Button size="lg" variant="outline" className="w-72" onClick={() => onFinish('skip')}>
              <WifiOff /> Skip (Use Offline Models)
            </Button>
          </>
        )}
      </div>
      <p className="mt-6 text-xs">
        Llama Run shares anonymous usage counts (never your messages or files). You can turn this off in Settings.
      </p>
    </Step>
  )
}

export function OnboardingApp() {
  const [step, setStep] = useState(0)
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY)
  useEffect(() => {
    void api.settings.hotkeyStatus().then((s) => setHotkey(s.active ?? s.requested))
  }, [])

  const finish = useCallback((mode: 'signin' | 'skip') => void api.onboarding.finish(mode), [])

  const steps = [
    <Step
      key="meet"
      title="Meet Llama Run"
      visual={
        <div className="size-40 rounded-full bg-[radial-gradient(circle_at_30%_30%,peachpuff,mediumpurple)] shadow-[0_0_80px_-10px_mediumpurple]" />
      }
    >
      Your AI assistant that lives one shortcut away. Ask anything, from anywhere, with local or cloud models.
    </Step>,
    <Step key="hotkey" title="Always One Second Away" visual={<Keycaps accelerator={hotkey} className="scale-[2.2] py-6" />}>
      Press the shortcut from any app to open Llama Run. Press it again, or click away, to hide it. You can change it in Settings.
    </Step>,
    <Step
      key="python"
      title="Powered by Python"
      visual={
        <div className="flex h-36 w-28 flex-col items-center justify-center gap-2 rounded-2xl border bg-card shadow-lg">
          <FileCode2 className="size-12 text-[#3776ab]" />
          <span className="font-mono text-sm">plugin.py</span>
        </div>
      }
    >
      Extend Llama Run with Python plugins. Python comes bundled, and plugin dependencies are installed with pip
      automatically, so there is nothing else to set up.
    </Step>,
    <ConnectStep key="connect" onFinish={finish} />
  ]
  const last = step === steps.length - 1

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col" key={step}>
        {steps[step]}
      </div>
      <div className="flex items-center justify-between px-8 pb-8">
        <Button variant="ghost" onClick={() => setStep((s) => s - 1)} className={cn(step === 0 && 'invisible')}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex gap-2">
          {steps.map((_, i) => (
            <button
              key={i}
              aria-label={`Step ${i + 1}`}
              onClick={() => setStep(i)}
              className={cn('size-2 rounded-full bg-foreground/20 transition-all', i === step && 'w-6 bg-primary')}
            />
          ))}
        </div>
        <Button onClick={() => setStep((s) => s + 1)} className={cn(last && 'invisible')}>
          {step === 0 ? 'Get Started' : 'Next'} <ArrowRight />
        </Button>
      </div>
    </div>
  )
}
