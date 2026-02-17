# Quick Start Guide for Developers

This guide helps you quickly get started with developing LlamaRun.

## Choose Your Development Mode

### 🚀 Quick Development (Recommended for most work)

Use the **unpackaged** build for:
- Daily feature development
- Bug fixes
- Quick testing
- Debugging

**Steps:**
1. Open `LlamaRun.sln` in Visual Studio 2022
2. Right-click **LlamaRun** project → Set as Startup Project
3. Press F5 to build and run

**Or from command line:**
```powershell
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Debug /p:Platform=x64
# Run the built executable (path may vary based on target framework)
.\LlamaRun\bin\x64\Debug\net9.0-windows10.0.26100.0\LlamaRun.exe
```

### 📦 Package Testing

Use the **packaged** build for:
- Testing installation experience
- Final pre-release validation
- Store submission preparation

**Steps:**
1. Open `LlamaRun.sln` in Visual Studio 2022
2. Right-click **LlamaRun.Packaged** project → Set as Startup Project
3. Build Solution (Ctrl+Shift+B)
4. Deploy the package

**Or from command line:**
```powershell
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always
```

## Common Commands

### Restore Dependencies
```powershell
nuget restore LlamaRun.sln
# or
dotnet restore
```

### Clean Build
```powershell
msbuild /t:Clean LlamaRun.sln
```

### Build Unpackaged (Fast)
```powershell
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64
```

### Build Packaged (Full)
```powershell
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64
```

## IDE Configuration

### Visual Studio 2022

**Set Default Startup Project:**
1. Right-click solution → Properties
2. Common Properties → Startup Project
3. Select **LlamaRun** for development

**Multiple Startup Projects (Advanced):**
You can configure both projects if needed, but typically you only need one at a time.

### Visual Studio Code

Add to `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "build-unpackaged",
      "command": "msbuild",
      "type": "shell",
      "args": [
        "LlamaRun\\LlamaRun.csproj",
        "/p:Configuration=Debug",
        "/p:Platform=x64"
      ],
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

## Debugging Tips

### Unpackaged App
- Standard debugging works out of the box
- Breakpoints in all code files
- Fast symbol loading
- Direct access to file system

### Packaged App
- Requires package deployment
- May need to enable Developer Mode in Windows
- Debugging is slower due to packaging overhead
- App runs in an app container

## Project Structure at a Glance

```
LlamaRun/
├── LlamaRun/                  # ⭐ Main unpackaged app (develop here)
│   ├── *.cs                   # C# source files
│   ├── *.xaml                 # UI definitions
│   ├── Assets/                # Embedded assets
│   └── LlamaRun.csproj
│
├── LlamaRun.Packaged/         # 📦 MSIX packaging (use for release)
│   ├── Images/                # Package assets
│   ├── Package.appxmanifest   # MSIX manifest
│   └── LlamaRun.Packaged.wapproj
│
├── CPythonIntrop/             # 🐍 Python integration
│   └── CPythonIntrop.vcxproj
│
└── LlamaRun.sln               # Solution file
```

## When to Use Which Build

| Scenario | Use | Reason |
|----------|-----|--------|
| Writing new features | Unpackaged | Faster iteration |
| Fixing bugs | Unpackaged | Easier debugging |
| Testing changes | Unpackaged | Quick verification |
| Integration testing | Unpackaged | No packaging overhead |
| Pre-release validation | Packaged | Test full experience |
| Store submission | Packaged | Required format |
| Testing updates | Packaged | Test update mechanism |
| Sandboxing tests | Packaged | Test app container |

## First-Time Setup

1. **Install Prerequisites:**
   - Visual Studio 2022 with:
     - .NET desktop development
     - Desktop development with C++
     - Windows application development
   - Windows SDK 10.0.26100.0 or higher
   - Git for Windows

2. **Clone Repository:**
   ```powershell
   git clone https://github.com/KrishBaidya/LlamaRun.git
   cd LlamaRun
   ```

3. **Restore and Build:**
   ```powershell
   nuget restore LlamaRun.sln
   msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Debug /p:Platform=x64
   ```

4. **Run:**
   ```powershell
   # Path may vary based on target framework configuration
   .\LlamaRun\bin\x64\Debug\net9.0-windows10.0.26100.0\LlamaRun.exe
   ```

## Troubleshooting

### "Cannot find Windows SDK"
Install Windows SDK 10.0.26100.0 or update `TargetPlatformVersion` in project files.

### "EnableMsixTooling error"
You're likely looking at an old version. Pull latest changes.

### "Python build fails"
First build takes 10-15 minutes as it builds Python. Be patient!

### Build is very slow
Switch to unpackaged build for development—it's much faster.

### Application crashes with error 0xC000027B
This is a WinUI 3 initialization error. The application includes error handling that creates a crash log at:
```
%LOCALAPPDATA%\LlamaRun\crash.log
```

Check this file for detailed error information. Common solutions:
1. **Install WebView2 Runtime**: Required for WebView controls
   - Download: https://developer.microsoft.com/microsoft-edge/webview2/
2. **Clean and rebuild**: `msbuild /t:Clean && msbuild /t:Build`
3. **Update NuGet packages**: Ensure all packages are current
4. **Check Windows App SDK**: Verify version 1.8 or later is installed

### Application shows blank window or doesn't load resources
1. Ensure you're running the built executable from the correct output directory
2. Check that Assets folder is properly deployed
3. Verify app.manifest is included in the build

## Getting Help

- **Documentation:** See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed info
- **Build Guide:** See [README.md](README.md) for comprehensive build instructions
- **Issues:** Report issues on GitHub

## Contributing

When contributing:
1. Develop against the **LlamaRun** (unpackaged) project
2. Test your changes with the unpackaged build
3. Before submitting PR, verify packaged build works
4. Include both build configurations in CI/CD tests

---

**Pro Tip:** Keep LlamaRun as your default startup project for 99% of your work. Only switch to LlamaRun.Packaged when you need to test packaging-specific functionality.
