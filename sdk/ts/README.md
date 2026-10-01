# TypeScript types for Llama Run plugin panels

Type definitions for `@llamarun/ui` and `@llamarun/plugin`, the two modules a plugin's TSX panels can import. The files are for editor support only: Llama Run compiles panels itself when it loads them, so there's nothing to build or install.

To get autocomplete, add a `tsconfig.json` next to your panels (see `examples/plugins/ui_showcase/ui/tsconfig.json`) that maps the modules to these files:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "paths": {
      "@llamarun/ui": ["<path to>/sdk/ts/llamarun-ui.d.ts"],
      "@llamarun/plugin": ["<path to>/sdk/ts/llamarun-plugin.d.ts"]
    }
  }
}
```

You also need `@types/react` for React's own types (`npm i -D @types/react`).
