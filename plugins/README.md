# Bundled plugins kept in this repository

These ship inside the installer (see `scripts/bundle-plugins.mjs`) and, like
every bundled plugin that isn't auto-granted, stay off until the user turns
them on and approves their permissions in Settings > Plugins.

- `usage_insights`: `/insights` and a panel with the last 30 days of token use (SDK 1.5 `usage`).
- `lsp_diagnostics`: language-server errors after the model edits a code file (SDK 1.5 tool-call hooks).
