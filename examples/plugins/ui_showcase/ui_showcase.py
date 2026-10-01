"""A tour of the plugin UI you can build with llamarun.ui.

Everything here is drawn by Llama Run with its own components, so it matches
the app in light and dark mode. The plugin only asks for the "llm"
permission (for "Ask the model"); it has no file, network or program access.

Other plugins can use it too: list "ui_showcase" under "dependencies", then
call ``llamarun.plugins.get("ui_showcase").add_note("...")`` or subscribe to
the ``ui_showcase.note_added`` event.
"""

import threading
import time

import llamarun
from llamarun import events, llm, settings, storage, ui


class Counter(ui.View):
    """A panel built in Python: render() returns a tree, set_state() re-renders it."""

    def __init__(self):
        super().__init__(count=0, history=[])

    def render(self):
        count = self.state["count"]
        return ui.Column(
            ui.Heading(f"Clicked {count} time{'s' if count != 1 else ''}"),
            ui.Text("Buttons call Python. Their handler gets the values of the inputs in the panel.", tone="muted"),
            ui.Row(
                ui.Input("step", "Step", default="1", type="number"),
                ui.Button("Add", on_click=self.add, icon="plus"),
                ui.Button("Reset", on_click=lambda: self.set_state(count=0, history=[]), variant="outline"),
                align="end",
            ),
            ui.Progress(min(100, count * 10), label="Progress to 10"),
            ui.List([f"+{n}" for n in self.state["history"][-5:]] or ["Nothing yet"], dividers=False),
        )

    def add(self, values):
        step = int(values.get("step") or 1)
        self.set_state(count=self.state["count"] + step, history=self.state["history"] + [step])


class Showcase(llamarun.Plugin):
    def on_load(self):
        # Settings → Plugins → UI Showcase. The app stores the values.
        ui.settings(
            ui.Switch("toasts", "Show toasts", default=True, description="Confirm actions with a small message."),
            ui.Select("hud_position", "Status card position", options={"bottom": "Bottom of the screen", "top": "Top of the screen"}),
            ui.Slider("hud_seconds", "Status demo length (seconds)", default=4, min=2, max=15),
        )
        self.counter = None
        self.notes = None

    # ------------------------------------------------------------- actions

    def on_counter(self):
        if self.counter is None:
            self.counter = ui.panel("Counter", view=Counter(), width=420, height=420)
        self.counter.show()

    def on_notes(self):
        if self.notes is None:
            self.notes = ui.panel("Notes", tsx="Notes", state={"notes": storage.get("notes", [])}, width=460, height=540)
            # Events sent from the TSX panel with emit()/call().
            self.notes.on("add", self.add_note)
            self.notes.on("remove", self._remove_note)
            self.notes.on("summarize", self._summarize)
        self.notes.show()

    def on_hud(self):
        seconds = float(settings.get("hud_seconds", 4))
        position = settings.get("hud_position", "bottom")
        # The HUD never takes focus, so it's safe to show while the user types elsewhere.
        hud = ui.hud("Listening…", "Say something", indicator="pulse", position=position)

        def demo():
            start = time.monotonic()
            while time.monotonic() - start < seconds / 2:
                hud.update(level=abs(((time.monotonic() * 3) % 2) - 1))
                time.sleep(1 / 30)
            hud.update(title="Thinking…", text="Working out an answer", indicator="spinner")
            time.sleep(seconds / 4)
            hud.update(title="Done", text="Click me to dismiss, or wait.", indicator="dot")
            hud.hide(after=seconds / 4)

        threading.Thread(target=demo, daemon=True).start()

    def on_ask(self):
        question = ui.prompt("Ask the model", "The answer opens in a panel.", placeholder="What's a good name for a cat?")
        if not question:
            return
        hud = ui.hud("Thinking…", question, indicator="spinner")
        try:
            answer = llm.generate(question)
        except llamarun.PluginError as exc:
            hud.close()
            ui.alert("Couldn't reach the model", str(exc))
            return
        hud.close()

        class Answer(ui.View):
            def render(self):
                return ui.Column(ui.Text(question, tone="muted"), ui.Markdown(answer))

        ui.panel("Answer", view=Answer(), width=520, height=480).show()

    # ------------------------------------------------ used by panels and plugins

    @llamarun.expose
    def add_note(self, text: str) -> int:
        """Add a note. Other plugins can call this; returns how many notes there are."""
        text = str(text).strip()
        if not text:
            return len(storage.get("notes", []))
        notes = storage.get("notes", []) + [{"text": text, "at": time.time()}]
        storage.set("notes", notes)
        if self.notes is not None:
            self.notes.set_state(notes=notes)
        events.publish("note_added", {"text": text, "count": len(notes)})
        if settings.get("toasts", True):
            ui.toast("Note added", kind="success")
        return len(notes)

    def _remove_note(self, index):
        notes = storage.get("notes", [])
        if 0 <= int(index) < len(notes) and ui.confirm("Delete this note?", notes[int(index)]["text"], confirm_label="Delete", destructive=True):
            notes.pop(int(index))
            storage.set("notes", notes)
            self.notes.set_state(notes=notes)

    def _summarize(self, _payload):
        notes = storage.get("notes", [])
        if not notes:
            return "There are no notes yet."
        return llm.generate("Summarize these notes in one sentence:\n" + "\n".join(f"- {n['text']}" for n in notes))
