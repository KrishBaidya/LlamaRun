# LlamaRun Project Structure

## Overview

The LlamaRun solution has been refactored into two distinct projects to support different deployment scenarios:

1. **LlamaRun** - Unpackaged core application
2. **LlamaRun.Packaged** - MSIX-packaged wrapper

## Project Details

### LlamaRun (Unpackaged)

**Purpose**: Standalone executable for development and testing

**Key Properties**:
- `EnableMsixTooling`: `false`
- `WindowsPackageType`: `None`
- `WindowsAppSDKSelfContained`: `true` (includes Windows App SDK runtime)
- Output: Standard Windows executable (`.exe`)
- No MSIX packaging dependencies

**Important Note**: The `WindowsAppSDKSelfContained=true` property ensures that the Windows App SDK runtime components are included in the build output. This is **critical** for unpackaged WinUI 3 apps - without it, XAML will silently crash while the app process continues running in the background.

**Use Cases**:
- Local development and debugging
- CI/CD builds without MSIX tooling
- Quick testing without installation
- Environments where MSIX packaging is not available

**Build Output Location**:
```
LlamaRun\bin\{Platform}\{Configuration}\net9.0-windows10.0.26100.0\win-{Platform}\
```

### LlamaRun.Packaged (MSIX Package)

**Purpose**: Production-ready MSIX package for distribution

**Key Properties**:
- Windows Application Packaging Project (.wapproj)
- References the unpackaged LlamaRun project
- Includes Package.appxmanifest
- Generates MSIX/APPX packages

**Use Cases**:
- Microsoft Store distribution
- Enterprise deployment via MSIX
- Side-loading scenarios
- Production releases

**Build Output Location**:
```
LlamaRun.Packaged\AppPackages\
```

## Building the Projects

### Visual Studio

#### Unpackaged (Development)
1. Open `LlamaRun.sln`
2. Set `LlamaRun` as startup project
3. Select platform (x64/x86/ARM64)
4. Press F5 to build and run

#### Packaged (Production)
1. Open `LlamaRun.sln`
2. Set `LlamaRun.Packaged` as startup project
3. Select platform (x64/x86/ARM64)
4. Press F5 to build, package, and deploy

### Command Line

#### Build Unpackaged
```powershell
# Debug build
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Debug /p:Platform=x64

# Release build
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64
```

#### Build Packaged
```powershell
# First restore NuGet packages
nuget restore LlamaRun.sln

# Build the package (requires certificate for signing)
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always /p:AppxPackageDir="PackageOutput"
```

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/msbuild.yml`) includes two jobs:

### build-unpackaged
- Builds the standalone executable
- No MSIX dependencies required
- Outputs to artifact: `LlamaRun-Unpackaged-x64`

### build-packaged
- Builds the MSIX package
- Requires certificate for signing
- Outputs to artifact: `LlamaRun-Packaged-x64`

## Migration Notes

### From the Old Structure
- The original `LlamaRun.csproj` had `EnableMsixTooling=true`
- Package.appxmanifest was in the LlamaRun project
- The project was tightly coupled to MSIX tooling

### What Changed
- `LlamaRun.csproj` now has MSIX disabled
- Package.appxmanifest moved to `LlamaRun.Packaged`
- Assets copied to `LlamaRun.Packaged` for packaging
- Solution updated to include both projects
- CI/CD split into two separate build jobs

### Backward Compatibility
- Existing Microsoft Store builds continue to work via `LlamaRun.Packaged`
- Development workflow simplified with unpackaged builds
- No changes to application code required

## Dependencies

### LlamaRun (Unpackaged)
- .NET 9.0 Windows SDK
- Windows App SDK
- All NuGet packages from original project
- CPythonIntrop (C++ component)

### LlamaRun.Packaged
- LlamaRun project (as entry point)
- CPythonIntrop project
- Windows SDK Build Tools
- Desktop Bridge for packaging

## Troubleshooting

### XAML crashes silently / App runs in background only
If the unpackaged app launches but no UI appears (XAML crashes silently):
- **Cause**: Windows App SDK runtime components are not included in the build output
- **Solution**: Ensure `WindowsAppSDKSelfContained` is set to `true` in LlamaRun.csproj
- This property includes the necessary WinUI 3 runtime files for unpackaged deployment

### "EnableMsixTooling" error
If you see MSIX-related errors when building the unpackaged project, ensure:
- `EnableMsixTooling` is set to `false` in LlamaRun.csproj
- `WindowsPackageType` is set to `None`

### Package build fails
If the packaged build fails:
- Ensure you have Windows SDK 10.0.26100.0 installed
- Check that the certificate is available (for signed builds)
- Verify the unpackaged project builds successfully first

### Missing dependencies
Both projects share dependencies. If you add new NuGet packages:
- Add to LlamaRun.csproj (the unpackaged core)
- The packaged project will inherit them through the project reference

## Best Practices

1. **Development**: Always use the unpackaged project for daily development
2. **Testing**: Test with unpackaged builds first, then validate with packaged builds
3. **CI/CD**: Run both build jobs to ensure compatibility
4. **Distribution**: Use packaged builds for all production releases
5. **Dependencies**: Add all dependencies to the core project, not the package project
