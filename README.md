# Llama Run 🦙
**Llama Run** is an AI-powered desktop assistant designed to help you automate tasks and streamline your workflow. Built with support for Python plugins, Llama Run allows you to create custom functionality and extend the app in ways that suit your needs.

## Features ✨
* Python Plugin Support (in progress): Write Python scripts to automate tasks and integrate third-party libraries.
* AI-Powered: Powered by Ollama and Llama (from Meta) for intelligent responses and automation.
* Customizable: Create plugins to modify and enhance Llama Run's capabilities according to your workflow.

## Getting Started 🛠
### Prerequisites

* Window application Development workload with C# WinUI app development tools (For Building from Source)
* Ollama for AI model support (you can install Ollama from [here](https://ollama.com/)).
* Visual Studio 2022 or MSBuild 17.0+ (for building Python components)
* Windows SDK 10.0.26100.0 or higher

Make sure you have these installed and configured properly before running the project.

### Building Python Components

The CPythonIntrop project requires Python headers, libraries, and DLLs to build. These can be automatically downloaded and built using the included MSBuild script.

#### Automated Build (Recommended)

To automatically download Python source, build DLLs, and organize files for the CPythonIntrop project:

```powershell
# Build Python 3.13.0 for x64 Release configuration (default)
msbuild BuildPython.targets /t:BuildPython

# Or specify custom options
msbuild BuildPython.targets /t:BuildPython /p:PythonVersion=3.13.0 /p:Platform=x64 /p:PythonConfiguration=Release
```

**Available Options:**
- `/p:PythonVersion=3.13.0` - Python version to download and build (default: 3.13.0)
- `/p:Platform=x64` - Target platform: x64, Win32, or ARM64 (default: x64)
- `/p:PythonConfiguration=Release` - Build configuration: Release or Debug (default: Release)

The build script will:
1. Download Python source code from GitHub (if not already downloaded)
2. Build Python DLLs and import libraries using MSBuild
3. Copy headers to `include/Python/`
4. Copy import libraries (.lib) to `libs/`
5. Copy runtime DLLs to `CPythonIntrop/DLL/`
6. Copy Python standard library to `Lib/`

#### Manual Build

If you prefer to set up Python components manually:

1. Download Python 3.13.0 source from [python.org](https://www.python.org/downloads/)
2. Build using `PCbuild/build.bat` in the Python source directory
3. Copy headers from `Include/` to `include/Python/`
4. Copy libraries from `PCbuild/amd64/` to `libs/`
5. Copy DLLs from `PCbuild/amd64/` to `CPythonIntrop/DLL/`
6. Copy standard library from `Lib/` to `Lib/`

#### Cleaning Build Artifacts

To remove downloaded Python source and build artifacts:

```powershell
msbuild BuildPython.targets /t:CleanPython
```

**Note:** This will not delete the copied headers, libraries, or DLLs in the project directories.

## Installation
Download Llama Run from the [Microsoft Store](https://apps.microsoft.com/store/detail/9NW950ZX02CQ?cid=DevShareMCLPCB).

Once installed, open the app and follow the on-screen instructions to start automating tasks and using Python plugins (coming soon!).

## Plugin Development (Coming Soon)
Plugin support is currently in progress. Soon, you'll be able to create and share Python plugins to extend Llama Run's functionality. Stay tuned for updates!

## Contributing 🤝
Contributions are welcome! If you'd like to help improve Llama Run, here's how you can contribute:

1. Install Window application Development workload with C# WinUI app development tools for Visual Studio

2. Fork the repository: Click on the "Fork" button at the top-right of the page to create your own copy of the project.

3. Clone your fork:

```bash
git clone https://github.com/KrishBaidya/LlamaRun.git
```
4. Create a new branch for your feature or fix:

```bash
git checkout -b feature/my-new-feature
```
5. Make your changes: Implement your feature or bug fix.

6. Commit your changes:

```bash
git commit -am 'Add new feature or fix bug'
```
7. Push to your fork:

```bash
git push origin feature/my-new-feature
```
8. Open a Pull Request: Go to the GitHub repository, click on the "Pull Request" button, and select your branch to create a PR.

## Roadmap
- [ ] Python Plugin System
    - [ ] Docs for Plugin System
    - [ ] Dependency Manager for Plugins
    - [ ] Plugin Marketplace
- [X] MCP Support

## License 📝
This project is licensed under the GPL v3.0 License. See the LICENSE file for more details.
