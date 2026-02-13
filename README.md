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
* Git for Windows (for cloning Python source)

Make sure you have these installed and configured properly before running the project.

### Building the Project

The CPythonIntrop project includes automated Python build integration. When you build the project in Visual Studio or via MSBuild, Python components will be automatically set up if not already present.

#### Building from Visual Studio (Recommended)

1. Open `LlamaRun.sln` in Visual Studio 2022
2. Select your desired configuration (Debug/Release) and platform (x64/ARM64)
3. Build the solution (F7 or Build > Build Solution)

The build process will automatically:
1. Clone Python source code from GitHub using git (if not already cloned)
2. Build Python DLLs and import libraries for your selected platform
3. Copy headers to `include/Python/`
4. Copy import libraries (.lib) to `libs/`
5. Copy runtime DLLs to `CPythonIntrop/DLL/`
6. Copy Python standard library to `Lib/`

**Note:** The first build may take 10-15 minutes as it clones and builds Python. Subsequent builds will be much faster as the Python components are cached.

#### Building from Command Line

```powershell
# Build the entire solution
msbuild LlamaRun.sln /p:Configuration=Release /p:Platform=x64
```

#### Customizing Python Version

To build with a different Python version, set the `PythonVersion` property:

```powershell
# Build with Python 3.12.0
msbuild LlamaRun.sln /p:Configuration=Release /p:Platform=x64 /p:PythonVersion=3.12.0
```

**Default:** Python 3.13.0

#### Manual Build

If you prefer to set up Python components manually or the automated build doesn't work:

1. Clone Python source: `git clone --depth 1 --branch v3.13.0 https://github.com/python/cpython.git build/python-src`
2. Build using `build/python-src/PCbuild/build.bat -p x64` (or your platform)
3. Copy headers from `build/python-src/Include/` to `include/Python/`
4. Copy `build/python-src/PC/pyconfig.h` to `include/Python/`
5. Copy libraries from `build/python-src/PCbuild/amd64/` to `libs/`
6. Copy DLLs from `build/python-src/PCbuild/amd64/` to `CPythonIntrop/DLL/`
7. Copy standard library from `build/python-src/Lib/` to `Lib/`

#### Cleaning Build Artifacts

To force a clean rebuild of Python components, delete the `build/` directory:

```powershell
Remove-Item -Recurse -Force build/
```

The next build will re-clone and rebuild Python from scratch.

#### Troubleshooting

**Build fails with "git is not recognized"**
- Install Git for Windows from [git-scm.com](https://git-scm.com/)
- Ensure git is in your PATH

**Build fails with "Cannot clone Python source"**
- Ensure you have internet connectivity
- Check that the `build/` directory is writable
- Try cloning manually: `git clone --depth 1 --branch v3.13.0 https://github.com/python/cpython.git build/python-src`

**Build fails during Python compilation**
- Verify Visual Studio 2022 or MSBuild 17.0+ is installed
- Ensure Windows SDK 10.0.26100.0 or higher is installed
- Check that the platform (x64, Win32, ARM64) matches your system architecture

**External dependencies download fails**
- The Python build requires external dependencies (OpenSSL, Tcl/Tk, etc.)
- Ensure `build/python-src/PCbuild/get_externals.bat` can access the internet
- Some corporate firewalls may block the download; check your network settings

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
