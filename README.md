# Llama Run 🦙
**Llama Run** is an AI-powered desktop assistant designed to help you automate tasks and streamline your workflow. Built with support for Python plugins, Llama Run allows you to create custom functionality and extend the app in ways that suit your needs.

## Project Structure

The project is now split into two configurations to support different use cases:

### **LlamaRun** (Unpackaged Core)
- Standalone executable (.exe) that runs without MSIX packaging
- Ideal for development, debugging, and testing
- No dependency on MSIX tooling
- Can be run directly from the build output
- Settings stored in `%LocalAppData%\LlamaRun\`

### **LlamaRun.Packaged** (Packaged App)
- MSIX-packaged version for production deployment
- Wraps the unpackaged core application
- Required for Microsoft Store distribution
- Supports full Windows App SDK features and capabilities
- Settings managed by MSIX container

## Features ✨
* Python Plugin Support (in progress): Write Python scripts to automate tasks and integrate third-party libraries.
* AI-Powered: Powered by Ollama and Llama (from Meta) for intelligent responses and automation.
* Customizable: Create plugins to modify and enhance Llama Run's capabilities according to your workflow.

## Getting Started 🛠
### Prerequisites

* Windows Application Development workload with C# WinUI app development tools (For Building from Source)
* Ollama for AI model support (you can install Ollama from [here](https://ollama.com/))

Make sure you have these installed and configured properly before running the project.

### Building from Source

#### Option 1: Build Unpackaged Version (for Development)

1. Clone the repository:
```bash
git clone https://github.com/KrishBaidya/LlamaRun.git
cd LlamaRun
```

2. Open `LlamaRun.sln` in Visual Studio

3. Set `LlamaRun` as the startup project (right-click → Set as Startup Project)

4. Build and run (F5 or Ctrl+F5)
   - The app will build as a standalone .exe
   - No MSIX packaging required
   - Output location: `LlamaRun\bin\x64\Debug\net9.0-windows10.0.26100.0\`

#### Option 2: Build Packaged Version (for Production/Store)

1. Clone the repository (if not already done)

2. Open `LlamaRun.sln` in Visual Studio

3. Set `LlamaRun.Packaged` as the startup project

4. Build and deploy (F5)
   - Creates MSIX package
   - Installs the app on your system
   - Suitable for distribution

### Command Line Builds

#### Build Unpackaged:
```powershell
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64
```

#### Build Packaged:
```powershell
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always /p:AppxPackageDir="PackageOutput"
```

## Installation
Download Llama Run from the [Microsoft Store](https://apps.microsoft.com/store/detail/9NW950ZX02CQ?cid=DevShareMCLPCB).

Once installed, open the app and follow the on-screen instructions to start automating tasks and using Python plugins (coming soon!).

## Plugin Development (Coming Soon)
Plugin support is currently in progress. Soon, you'll be able to create and share Python plugins to extend Llama Run's functionality. Stay tuned for updates!

## Contributing 🤝
Contributions are welcome! If you'd like to help improve Llama Run, here's how you can contribute:

1. Install Windows Application Development workload with C# WinUI app development tools for Visual Studio

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
