"""Reference plugin for SDK 1.4: plugins that shape the chat itself.

- /clock posts a live HTML card (no model involved).
- /remember <fact> saves to the AI's memory; /memories lists it.
- Every message the user's models see gets the local date and time as context.
- A setting switches on an emerald theme for the whole app.

It asks for "commands", "context", "memory" and "appearance" in plugin.json:
no files, network or programs. Install it from Settings -> Plugins -> Install from Disk.
"""

import threading
from datetime import datetime

import llamarun
from llamarun import app, chats, memory, settings, ui

THEME = """
:root, .dark {
  --primary: oklch(0.70 0.17 162);
  --ring: oklch(0.70 0.17 162);
  --radius: 0.5rem;
}
"""

CLOCK = """```html
<div style="font-family:system-ui;display:flex;align-items:center;gap:16px;padding:18px 22px;
            border-radius:16px;background:linear-gradient(135deg,#0f766e,#1e3a8a);color:white">
  <div id="t" style="font:700 44px/1 system-ui;font-variant-numeric:tabular-nums"></div>
  <div><div id="d" style="font-weight:600"></div><div style="opacity:.75;font-size:13px">Live, from the Chat Studio plugin</div></div>
</div>
<script>
  function tick() {
    const now = new Date()
    t.textContent = now.toLocaleTimeString()
    d.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  }
  tick(); setInterval(tick, 1000)
</script>
```"""


class ChatStudio(llamarun.Plugin):
    def on_load(self) -> None:
        ui.settings(ui.Switch("theme", "Emerald theme", default=False, description="Restyle Llama Run's windows."))
        self._apply_theme()

        chats.add_command("clock", self.clock, description="A live clock card")
        chats.add_command("remember", self.remember, description="Save something to the AI's memory", args="<fact>")
        chats.add_command("memories", self.memories, description="What the AI remembers about you")

        self._stop = threading.Event()
        threading.Thread(target=self._context_loop, daemon=True).start()

    def on_unload(self) -> None:
        self._stop.set()

    # Live context: refreshed every minute, so the model always knows "now".
    def _context_loop(self) -> None:
        while not self._stop.is_set():
            now = datetime.now().astimezone()
            chats.set_context(f"Current local time: {now:%A %d %B %Y, %H:%M} ({now.tzname()}).", key="clock")
            self._stop.wait(60)

    @settings.on_change
    def _apply_theme(self, *_changed) -> None:
        if settings.get("theme", False):
            app.set_theme(THEME)
        else:
            app.clear_theme()

    def clock(self, args: str, chat_id: str) -> str:
        return CLOCK

    def remember(self, args: str, chat_id: str) -> str:
        if not args.strip():
            return "Tell me what to remember, like `/remember I'm vegetarian`."
        saved = memory.add(args)
        return f"Saved to memory: **{saved.text}**"

    def memories(self, args: str, chat_id: str) -> str:
        items = memory.list()
        if not items:
            return "The AI doesn't remember anything about you yet."
        rows = "\n".join(f"| {m.text} | {m.source} |" for m in items)
        return f"| Memory | Saved by |\n|---|---|\n{rows}"
