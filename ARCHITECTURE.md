# LlamaRun Project Structure

This document describes the project structure and the relationship between the unpackaged and packaged projects.

## Overview

The LlamaRun solution consists of three main projects:

1. **LlamaRun** - Unpackaged WinUI 3 application (core app)
2. **LlamaRun.Packaged** - Windows Application Packaging Project (MSIX wrapper)
3. **CPythonIntrop** - C++ interop project for Python integration

## Project Details

### LlamaRun (Unpackaged)

**Project Type:** .NET 9.0 WinUI 3 Application  
**Output:** Native executable (.exe)  
**Location:** `LlamaRun/LlamaRun.csproj`

**Key Properties:**
- `EnableMsixTooling`: false
- `WindowsPackageType`: None
- `WindowsAppSDKSelfContained`: true
- `OutputType`: WinExe

**Purpose:**
This is the core application containing all the business logic, UI, and functionality. It's configured as a standalone unpackaged app that can run directly without MSIX packaging.

**Use Cases:**
- Daily development and debugging
- Unit testing
- CI/CD builds that don't require packaging
- Quick iteration on features
- Running the app without installation

**Build Output:**
The compiled application is placed in `LlamaRun/bin/<Platform>/<Configuration>/` and can be executed directly.

### LlamaRun.Packaged (Packaged)

**Project Type:** Windows Application Packaging Project (.wapproj)  
**Output:** MSIX package  
**Location:** `LlamaRun.Packaged/LlamaRun.Packaged.wapproj`

**Key Properties:**
- `EntryPointProjectUniqueName`: References LlamaRun.csproj
- `AppxBundle`: Always
- Contains Package.appxmanifest and app assets

**Purpose:**
This project wraps the unpackaged LlamaRun application in an MSIX package for distribution. It doesn't contain any application code itself—it's purely a packaging layer.

**Use Cases:**
- Production releases to Microsoft Store
- Enterprise distribution
- MSIX deployment scenarios
- Testing the full packaged experience
- When sandboxed security model is required

**Build Output:**
The packaged output (MSIX bundles and installers) is placed in `LlamaRun.Packaged/AppPackages/` or `LlamaRun.Packaged/Package/`.

### CPythonIntrop

**Project Type:** C++ Windows Runtime Component  
**Location:** `CPythonIntrop/CPythonIntrop.vcxproj`

**Purpose:**
Provides Python interoperability for the application, including automated building of Python components.

## Build Configurations

### Building the Unpackaged App

**Visual Studio:**
1. Set LlamaRun as startup project
2. Select configuration (Debug/Release) and platform (x86/x64/ARM64)
3. Press F5 or Ctrl+F5

**Command Line:**
```powershell
# Restore packages
nuget restore LlamaRun.sln

# Build
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64
```

**Output Location:**
`LlamaRun\bin\x64\Release\net9.0-windows10.0.26100.0\`

### Building the Packaged App

**Visual Studio:**
1. Set LlamaRun.Packaged as startup project
2. Select configuration (Debug/Release) and platform (x86/x64/ARM64)
3. Build solution (F7)

**Command Line:**
```powershell
# Restore packages
nuget restore LlamaRun.sln

# Build
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always
```

**Output Location:**
`LlamaRun.Packaged\AppPackages\` or `LlamaRun.Packaged\Package\`

## CI/CD Workflows

### Unpackaged Build Workflow

**File:** `.github/workflows/build-unpackaged.yml`

**Purpose:** Builds the unpackaged application for validation and testing

**Artifacts:** 
- `LlamaRun-Unpackaged-x64` - Contains the standalone executable and dependencies

### Packaged Build Workflow

**File:** `.github/workflows/msbuild.yml`

**Purpose:** Builds the MSIX package for distribution

**Artifacts:**
- `LlamaRun-Packaged-x64` - Contains MSIX bundles and installers

## Assets and Resources

### Unpackaged App Assets
Located in: `LlamaRun/Assets/`

These assets are embedded in the unpackaged executable for standalone operation.

### Packaged App Assets
Located in: `LlamaRun.Packaged/Images/`

These are the MSIX package assets used in the Windows App package manifest. They include:
- App icons at various sizes
- Splash screen
- Tile images (small, medium, wide, large)
- Store logos

## Development Workflow Recommendations

### For Feature Development
1. Use the unpackaged build (LlamaRun project)
2. Faster build times without packaging overhead
3. Direct debugging without package deployment
4. Iterate quickly on changes

### Before Release
1. Build and test the unpackaged app thoroughly
2. Switch to packaged build (LlamaRun.Packaged)
3. Test the full MSIX installation experience
4. Validate app behavior in packaged environment
5. Test updates and uninstallation

### For CI/CD
- Run unpackaged builds on every commit/PR for fast validation
- Run packaged builds on main branch or release branches
- Store both artifact types for different deployment scenarios

## Key Differences

| Aspect | Unpackaged | Packaged |
|--------|-----------|----------|
| Build Time | Faster | Slower (includes packaging) |
| Deployment | Copy & run | Install via MSIX |
| Debugging | Native debugging | Package deployment required |
| Updates | Manual | App Store or Update Service |
| Storage | File system access | App container |
| Distribution | Direct EXE | Microsoft Store/Enterprise |

## Migration Notes

### Changes from Previous Structure

Previously, LlamaRun was a single-project MSIX app with `EnableMsixTooling=true`. The refactoring:

1. **Removed from LlamaRun.csproj:**
   - `EnableMsixTooling` set to false
   - MSIX-specific properties (AppxBundle, PackageCertificate, etc.)
   - Package.appxmanifest (moved to LlamaRun.Packaged)

2. **Added to LlamaRun.csproj:**
   - `WindowsPackageType=None`
   - `WindowsAppSDKSelfContained=true`

3. **Created LlamaRun.Packaged:**
   - New Windows Application Packaging Project
   - Contains Package.appxmanifest
   - Contains package-specific assets
   - References LlamaRun project

### Benefits of This Structure

1. **Separation of Concerns**: Application logic is separate from packaging
2. **Flexibility**: Can build and test without packaging requirements
3. **CI/CD Optimization**: Faster builds for non-packaging scenarios
4. **Development Experience**: Improved iteration speed
5. **Future-Proof**: Easier to support multiple packaging formats

## Troubleshooting

### Unpackaged Build Issues

**Problem**: App doesn't start or crashes on launch  
**Solution**: Ensure `WindowsAppSDKSelfContained=true` is set so runtime is included

**Problem**: Missing dependencies  
**Solution**: Check that all required NuGet packages are restored

### Packaged Build Issues

**Problem**: Build fails with "Cannot find EntryPointProjectUniqueName"  
**Solution**: Verify the path to LlamaRun.csproj in LlamaRun.Packaged.wapproj

**Problem**: Assets not found  
**Solution**: Ensure Images folder contains all required assets listed in Package.appxmanifest

**Problem**: Certificate errors  
**Solution**: For development, disable signing in project properties or provide a test certificate

## References

- [Windows App SDK Deployment Guide](https://docs.microsoft.com/windows/apps/windows-app-sdk/deployment-guide)
- [Package a desktop app using Visual Studio](https://docs.microsoft.com/windows/msix/desktop/desktop-to-uwp-packaging-dot-net)
- [Windows Application Packaging Project](https://docs.microsoft.com/windows/msix/desktop/desktop-to-uwp-root)
