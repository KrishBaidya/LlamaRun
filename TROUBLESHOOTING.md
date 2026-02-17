# Troubleshooting Guide - LlamaRun

This document provides solutions to common issues when building and running LlamaRun.

## Application Startup Issues

### Error 0xC000027B - Application-Internal Exception

**Symptoms:**
- Application crashes immediately on startup
- Error message: "Unhandled exception at 0x... (Microsoft.UI.Xaml.dll) in LlamaRun.exe: 0xC000027B"
- Occurs in `Microsoft.UI.Xaml.Application.Start()` method

**Root Cause:**
This error indicates a WinUI 3 initialization failure, typically in unpackaged applications. Common causes include:
- Missing or incompatible Windows App SDK runtime
- Missing WebView2 runtime
- Corrupted XAML resources
- Improper application manifest configuration
- Missing or corrupted dependencies

**Solutions:**

#### 1. Check the Crash Log
LlamaRun includes automatic crash logging. Check the log file at:
```
%LOCALAPPDATA%\LlamaRun\crash.log
```

This file contains detailed error information including:
- Full exception message
- Stack trace
- Inner exceptions
- Timestamp

#### 2. Install WebView2 Runtime
The application uses WebView2 controls which require the runtime:

1. Download the Evergreen Bootstrapper: https://developer.microsoft.com/microsoft-edge/webview2/
2. Run the installer
3. Restart your computer
4. Try running LlamaRun again

#### 3. Clean and Rebuild
Corrupted build artifacts can cause initialization issues:

```powershell
# Navigate to the repository root
cd path\to\LlamaRun

# Clean the solution
msbuild /t:Clean LlamaRun.sln

# Delete bin and obj folders
Remove-Item -Recurse -Force LlamaRun\bin, LlamaRun\obj

# Restore NuGet packages
nuget restore LlamaRun.sln

# Rebuild
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Debug /p:Platform=x64
```

#### 4. Update Windows App SDK
Ensure you have the latest Windows App SDK:

1. Open Visual Studio 2022
2. Go to Extensions → Manage Extensions
3. Search for "Windows App SDK"
4. Update if available
5. Restart Visual Studio

#### 5. Verify NuGet Packages
Check that all NuGet packages are correctly installed:

```powershell
# In the repository root
dotnet restore LlamaRun\LlamaRun.csproj
```

Or in Visual Studio:
- Right-click solution → Restore NuGet Packages

#### 6. Check Windows SDK Version
The project requires Windows SDK 10.0.26100.0 or higher:

1. Open Visual Studio Installer
2. Modify Visual Studio 2022
3. Individual Components tab
4. Search for "Windows SDK"
5. Ensure 10.0.26100.0 or later is installed

#### 7. Verify Application Manifest
Ensure `app.manifest` contains proper configuration:

```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="LlamaRun.app"/>
  
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>
  
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
```

## Build Issues

### Duplicate Program Class Definition

**Problem**: Build fails with "The namespace 'LlamaRun' already contains a definition for 'Program'"

**Root Cause**: The project has `EnableDefaultApplicationDefinition=false` set, which is incorrect for WinUI 3 apps. This property is for WPF/Windows Forms applications.

**Solution**:
1. Remove the `EnableDefaultApplicationDefinition` property from the project file
2. WinUI 3 apps automatically detect and use custom Program.cs files
3. Clean and rebuild:
   ```powershell
   msbuild /t:Clean LlamaRun.sln
   msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Debug /p:Platform=x64
   ```

**Technical Details**:
- WinUI 3 uses a different build system than WPF/Windows Forms
- Custom Program.cs is auto-detected without special properties
- The custom Program.cs provides error handling and crash logging
- No additional configuration needed for custom entry points

### Python Build Fails

**Problem**: First build fails during Python component building

**Solutions:**
1. Ensure Git for Windows is installed and in PATH
2. Wait patiently - first build takes 10-15 minutes
3. Check internet connectivity (downloads Python source)
4. Delete `build/` folder and try again

### Slow Build Performance

**Problem**: Builds take too long

**Solutions:**
1. Use unpackaged build for development (much faster)
2. Use incremental builds (don't clean unnecessarily)
3. Close resource-intensive applications
4. Use SSD for source code location

### Missing Windows SDK

**Problem**: Error about missing Windows SDK

**Solutions:**
1. Install Windows SDK 10.0.26100.0 via Visual Studio Installer
2. Or update `TargetPlatformVersion` in LlamaRun.csproj
3. Or update `TargetPlatformVersion` in CPythonIntrop.vcxproj

### MSBuild Not Found

**Problem**: `msbuild` command not recognized

**Solutions:**
1. Add MSBuild to PATH:
   ```powershell
   # Add to PATH (adjust version as needed)
   $env:Path += ";C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin"
   ```

2. Or use Visual Studio Developer Command Prompt
3. Or use Developer PowerShell for Visual Studio

## Runtime Issues

### Blank Window

**Problem**: Application starts but shows blank window

**Possible Causes:**
1. XAML resources not loaded
2. Assets not deployed
3. Initialization error in App.xaml.cs

**Solutions:**
1. Check crash log at `%LOCALAPPDATA%\LlamaRun\crash.log`
2. Verify Assets folder exists in output directory
3. Run with debugger attached to see exceptions

### Application Won't Start

**Problem**: Double-clicking executable does nothing

**Solutions:**
1. Run from command line to see error messages:
   ```powershell
   cd LlamaRun\bin\x64\Debug\net9.0-windows10.0.26100.0
   .\LlamaRun.exe
   ```

2. Check Windows Event Viewer:
   - Windows Logs → Application
   - Look for errors from LlamaRun.exe

3. Ensure all dependencies are in the same folder as executable

### Features Don't Work

**Problem**: Specific features like MCP servers or plugins don't work

**Solutions:**
1. Check if Ollama is installed and running
2. Verify configuration files in `%LOCALAPPDATA%\LlamaRun\`
3. Check application logs
4. Ensure Python components are built correctly

## Packaged Build Issues

### Cannot Find EntryPointProjectUniqueName

**Problem**: Build fails with "Cannot find EntryPointProjectUniqueName"

**Solution:** Verify the path in LlamaRun.Packaged.wapproj:
```xml
<EntryPointProjectUniqueName>..\LlamaRun\LlamaRun.csproj</EntryPointProjectUniqueName>
```

### Assets Not Found

**Problem**: Build fails with asset errors

**Solution:** Ensure Images folder in LlamaRun.Packaged contains all required assets

### Certificate Errors

**Problem**: Build fails with certificate/signing errors

**Solutions:**
1. For development, disable signing in project properties
2. Or provide a test certificate
3. Check AppxPackageSigningEnabled setting

## Development Environment Issues

### Visual Studio Can't Load Project

**Problem**: Visual Studio shows project load errors

**Solutions:**
1. Close Visual Studio
2. Delete `.vs` folder
3. Delete `bin` and `obj` folders
4. Reopen solution
5. Restore NuGet packages

### IntelliSense Not Working

**Problem**: IntelliSense or code completion not working

**Solutions:**
1. Close and reopen files
2. Rebuild solution
3. Delete `.vs` folder and restart Visual Studio
4. Tools → Options → Text Editor → C# → IntelliSense → Clear cache

## Getting More Help

If none of these solutions work:

1. **Check Crash Log**: `%LOCALAPPDATA%\LlamaRun\crash.log`
2. **Enable Diagnostic Logging**: Run with debugger attached
3. **Check GitHub Issues**: Search the repository's issue tracker
4. **Create New Issue**: Include:
   - Error message and crash log
   - Steps to reproduce
   - Windows version
   - Visual Studio version
   - Whether packaged or unpackaged build

## Quick Reference

### Important Paths

- **Crash Log**: `%LOCALAPPDATA%\LlamaRun\crash.log`
- **App Data**: `%LOCALAPPDATA%\LlamaRun\`
- **Build Output**: `LlamaRun\bin\<Platform>\<Configuration>\`
- **Python Build**: `build\python-src\`

### Essential Commands

```powershell
# Clean build
msbuild /t:Clean LlamaRun.sln

# Restore packages
nuget restore LlamaRun.sln

# Build unpackaged
msbuild LlamaRun\LlamaRun.csproj /p:Platform=x64

# Build packaged
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Platform=x64

# Delete build artifacts
Remove-Item -Recurse -Force LlamaRun\bin, LlamaRun\obj, build\
```

### Common Error Codes

| Error Code | Description | Common Solution |
|------------|-------------|-----------------|
| 0xC000027B | WinUI initialization failure | Install WebView2, clean rebuild |
| 0x80070002 | File not found | Check Assets deployment |
| 0x80131500 | CLR initialization error | Check .NET installation |
| 0x8007007E | Module not found | Missing DLL dependencies |

## Prevention Tips

1. **Keep Dependencies Updated**: Regularly update NuGet packages
2. **Use Unpackaged for Development**: Faster iteration
3. **Regular Clean Builds**: Prevent corrupted artifacts
4. **Check Requirements**: Before building, verify all prerequisites
5. **Monitor Logs**: Check crash logs after any error

---

For more information, see:
- [ARCHITECTURE.md](ARCHITECTURE.md) - Project structure
- [QUICKSTART.md](QUICKSTART.md) - Quick start guide
- [README.md](README.md) - General information
