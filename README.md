# Llama Run 🦙
**Llama Run** is an AI-powered desktop assistant designed to help you automate tasks and streamline your workflow. Built with support for Python plugins, Llama Run allows you to create custom functionality and extend the app in ways that suit your needs.

## Project Structure 📁

The repository is organized into two main projects to support both development and production workflows:

### **LlamaRun** (Unpackaged)
- **Purpose**: Standalone unpackaged WinUI 3 application
- **Output**: Native `.exe` executable
- **Use Case**: Development, debugging, and testing without MSIX packaging requirements
- **Benefits**:
  - No dependencies on MSIX tooling
  - Faster iteration during development
  - Can run directly without installation
  - Compatible with CI/CD environments where packaging isn't needed

### **LlamaRun.Packaged** (Packaged)
- **Purpose**: Windows Application Packaging Project (MSIX)
- **Output**: MSIX package for distribution
- **Use Case**: Production deployment via Microsoft Store or enterprise distribution
- **Benefits**:
  - Professional installation experience
  - Automatic updates
  - Sandboxed security model
  - Microsoft Store compatibility

Both projects share the same core codebase, with the packaged version serving as a thin wrapper around the unpackaged application.

## Features ✨
* Python Plugin Support (in progress): Write Python scripts to automate tasks and integrate third-party libraries.
* AI-Powered: Powered by Ollama and Llama (from Meta) for intelligent responses and automation.
* Customizable: Create plugins to modify and enhance Llama Run's capabilities according to your workflow.

## Getting Started 🛠
### Prerequisites

* Window application Development workload with C# WinUI app development tools (For Building from Source)
* Ollama for AI model support (you can install Ollama from [here](https://ollama.com/)).
* **Visual Studio 2022** (recommended) or MSBuild 17.0+ with v143 platform toolset
* Windows SDK 10.0.26100.0 or higher
* Git for Windows (for cloning Python source)

**Important:** The project is configured to use the **v143 platform toolset** (Visual Studio 2022). CPython will be built with the same toolset to ensure binary compatibility. If you have multiple Visual Studio versions installed, make sure Visual Studio 2022 is available, or the build may fall back to older toolsets like v140 (VS2015), which can cause compatibility issues.

Make sure you have these installed and configured properly before running the project.

### Building the Project

The project supports two build configurations:
1. **Unpackaged Build**: For development and testing
2. **Packaged Build**: For production deployment

The CPythonIntrop project includes automated Python build integration. When you build the project in Visual Studio or via MSBuild, Python components will be automatically set up if not already present.

#### Building the Unpackaged App (Development)

For rapid development and testing without MSIX packaging:

**From Visual Studio (Recommended)**
1. Open `LlamaRun.sln` in Visual Studio 2022
2. Set **LlamaRun** as the startup project
3. Select your desired configuration (Debug/Release) and platform (x64/ARM64)
4. Build and run (F5)

**From Command Line**
```powershell
# Build the unpackaged application
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64
```

The unpackaged app will be available in `LlamaRun\bin\<Platform>\<Configuration>\` and can be run directly without installation.

#### Building the Packaged App (Production)

For creating MSIX packages for distribution:

**From Visual Studio (Recommended)**

**From Visual Studio (Recommended)**
1. Open `LlamaRun.sln` in Visual Studio 2022
2. Set **LlamaRun.Packaged** as the startup project
3. Select your desired configuration (Debug/Release) and platform (x64/ARM64)
4. Build the solution (F7 or Build > Build Solution)

**From Command Line**
```powershell
# Build the packaged application (MSIX)
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always
```

The packaged output will be available in `LlamaRun.Packaged\AppPackages\` or `LlamaRun.Packaged\Package\`.

#### What Gets Built Automatically

For both build configurations, the build process will automatically:
1. Clone Python source code from GitHub using git (if not already cloned)
2. Build Python DLLs and import libraries for your selected platform
3. Copy headers to `include/Python/`
4. Copy import libraries (.lib) to `libs/`
5. Copy runtime DLLs to `CPythonIntrop/DLL/`
6. Copy Python standard library to `Lib/`

**Note:** The first build typically takes 10-15 minutes (depending on network speed and machine performance) as it clones and builds Python. Subsequent builds will be much faster as the Python components are cached.

#### Building from Command Line (Alternative)

For CI/CD or automated builds:

**Unpackaged App**
```powershell
# Restore NuGet packages
nuget restore LlamaRun.sln

# Build the unpackaged app
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64
```

**Packaged App**
```powershell
# Restore NuGet packages
nuget restore LlamaRun.sln

# Build the packaged app
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always
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

1. Clone Python source with your desired version (replace v3.13.0 with the version you want):
   ```powershell
   git clone --depth 1 --branch v3.13.0 https://github.com/python/cpython.git build/python-src
   ```
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

**Build reports "requires v140 toolkit" or toolset mismatch errors**
- This happens when CPython auto-detects and uses a different platform toolset than CPythonIntrop
- **Solution:** Ensure Visual Studio 2022 with v143 toolset is installed and is the primary/default version
- The build system now explicitly passes the platform toolset to CPython to avoid mismatches
- If you need to use a different toolset, modify both:
  - `CPythonIntrop.vcxproj`: Change `<PlatformToolset>v143</PlatformToolset>` 
  - The toolset will automatically be passed to CPython during build
- Common toolset versions:
  - v143 = Visual Studio 2022 (recommended)
  - v142 = Visual Studio 2019
  - v141 = Visual Studio 2017
  - v140 = Visual Studio 2015

**Build fails with "Could not copy pyconfig.h" or file not found errors**
- This error occurs if the Python build didn't complete successfully
- **Solution:** Delete the `build/` directory and rebuild: `Remove-Item -Recurse -Force build/`
- The build system automatically copies `pyconfig.h` from the Python build output after compilation
- If the error persists, check that:
  - The Python build completed without errors (check build output)
  - You have write permissions to the `build/` directory
  - Anti-virus software isn't blocking file operations

**External dependencies download fails**
- The Python build requires external dependencies (OpenSSL, Tcl/Tk, etc.)
- Ensure `build/python-src/PCbuild/get_externals.bat` can access the internet
- Some corporate firewalls may block the download; check your network settings

## Installation
Download Llama Run from the [Microsoft Store](https://apps.microsoft.com/store/detail/9NW950ZX02CQ?cid=DevShareMCLPCB).

Once installed, open the app and follow the on-screen instructions to start automating tasks and using Python plugins (coming soon!).

## Development vs Production 🔧

### When to Use the Unpackaged Build
- During active development and debugging
- For quick testing of new features
- In CI/CD environments where you only need to verify code compiles
- When you don't have MSIX tooling installed
- For manual testing without installation

### When to Use the Packaged Build  
- For production releases to the Microsoft Store
- For enterprise distribution via MSIX
- When you need the full sandboxed security model
- For testing the complete installation and update experience
- For final validation before release

Both builds produce functionally identical applications; the only difference is the deployment mechanism.

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
