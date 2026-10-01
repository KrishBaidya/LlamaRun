// Types for `@llamarun/plugin` in plugin panels (TSX): talking to your
// plugin's Python code. Python owns the state and handles the events:
//
//   panel = ui.panel("Notes", tsx="Notes", state={"notes": []})
//   panel.on("add", self.add_note)          # emit("add", text) / call("add", text)
//   panel.set_state(notes=[...])            # usePluginState() re-renders

/** The state your plugin shares with this panel. The component re-renders when Python changes it. */
export declare function usePluginState<T extends object = Record<string, unknown>>(): T

/** Send an event to the plugin's `panel.on(event)` handler without waiting for it. */
export declare function emit(event: string, payload?: unknown): void

/** Call the plugin's `panel.on(event)` handler and get what it returns. Rejects if it raises. */
export declare function call<T = unknown>(event: string, payload?: unknown): Promise<T>

/** Close this panel window. */
export declare function close(): void

/** Change the window title. */
export declare function setTitle(title: string): void

/** Which plugin and panel this is. */
export declare function usePanel(): { pluginId: string; pluginName: string; title: string }
