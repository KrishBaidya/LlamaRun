# Migration Guide: Unpackaged and Packaged Projects

## Overview

This guide helps existing developers and users understand the changes introduced by splitting the project into unpackaged and packaged variants.

## For Existing Developers

### What Changed?

Previously, the LlamaRun project had MSIX tooling enabled by default, requiring Visual Studio with packaging components and making it difficult to build and test quickly.

Now, the project is split into:
- **LlamaRun**: Unpackaged project (standalone .exe)
- **LlamaRun.Packaged**: Packaged project (MSIX wrapper)

### Impact on Your Workflow

#### If You Were Building Locally:

**Before:**
```powershell
# Required MSIX tooling
msbuild LlamaRun.sln /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always
```

**After (Development):**
```powershell
# No MSIX required - much faster!
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64
```

**After (Production/Store):**
```powershell
# Only when you need MSIX package
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always
```

#### If You Were Using Visual Studio:

**Before:**
- One project with MSIX always enabled
- Slower builds due to packaging overhead
- Required packaging components installed

**After (Development):**
1. Set `LlamaRun` as startup project
2. Build and run directly (F5)
3. No packaging overhead
4. Faster iteration

**After (Production/Store):**
1. Set `LlamaRun.Packaged` as startup project
2. Build creates MSIX package
3. Deploy to test installation

### What You Need to Do

#### Recommended Changes:
1. **Update your startup project** in Visual Studio to `LlamaRun` for daily development
2. **Use `LlamaRun.Packaged`** only when you need to test the MSIX package
3. **Update any build scripts** to target the appropriate project

#### No Changes Required For:
- Application code (unchanged)
- Dependencies (same NuGet packages)
- Assets (copied to packaged project)
- Git workflow (no branch changes)

## For CI/CD Pipeline Maintainers

### GitHub Actions Workflow Changes

The workflow now has two jobs instead of one:

#### New Job: `build-unpackaged`
- Builds the standalone .exe
- No certificate required
- Faster build time
- Outputs to: `LlamaRun-Unpackaged-x64` artifact

#### Updated Job: `build-packaged`
- Builds MSIX package
- Still requires certificate (no change)
- Outputs to: `LlamaRun-Packaged-x64` artifact

### What to Update

If you have custom CI/CD pipelines:

1. **Split your build step** into two jobs (optional but recommended)
2. **Update artifact paths**:
   - Unpackaged: `LlamaRun\bin\x64\Release\net9.0-windows10.0.26100.0\win-x64\`
   - Packaged: `PackageOutput\` (or your custom AppxPackageDir)

3. **Update build commands**:
   ```yaml
   # Unpackaged
   - run: msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64
   
   # Packaged
   - run: msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always
   ```

## For End Users

### If You Download from Microsoft Store
**No change** - You still get the same MSIX package as before. The packaged project ensures the Store version continues to work exactly as it did.

### If You Build from Source
You now have two options:

#### Option 1: Quick Build (Recommended for Testing)
```powershell
# Clone and build
git clone https://github.com/KrishBaidya/LlamaRun.git
cd LlamaRun
msbuild LlamaRun\LlamaRun.csproj /p:Configuration=Release /p:Platform=x64

# Run the .exe directly
.\LlamaRun\bin\x64\Release\net9.0-windows10.0.26100.0\win-x64\LlamaRun.exe
```

#### Option 2: Full Package (Same as Store)
```powershell
# Clone, build, and package
git clone https://github.com/KrishBaidya/LlamaRun.git
cd LlamaRun
msbuild LlamaRun.Packaged\LlamaRun.Packaged.wapproj /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Always

# Install the MSIX package
# (requires developer mode or certificate trust)
```

## Troubleshooting

### Issue: "App launches but no UI appears" or "XAML crashes silently"
**Solution**: This occurs when the Windows App SDK runtime is not included. The fix has been applied:
- `WindowsAppSDKSelfContained=true` is now set in LlamaRun.csproj
- This ensures all necessary WinUI 3 runtime components are included in the build output
- Pull the latest changes to get this fix

### Issue: "Cannot find LlamaRun.Packaged"
**Solution**: Pull the latest changes. The packaged project is new.

### Issue: "MSIX tooling errors in LlamaRun project"
**Solution**: The core project no longer uses MSIX. If you see these errors, ensure:
- `EnableMsixTooling` is `false` in LlamaRun.csproj
- You're not trying to create a package from the core project

### Issue: "Unpackaged build doesn't create MSIX"
**Solution**: That's correct! Use `LlamaRun.Packaged` for MSIX packages.

### Issue: "Where are my app settings/data?"
**Solution**: 
- Unpackaged builds use the standard Windows app data location
- Packaged builds use the MSIX container
- They may not share the same data location

## Benefits of This Change

### For Developers:
- ✅ Faster builds (no packaging overhead)
- ✅ Easier debugging (direct .exe)
- ✅ No MSIX tooling required for development
- ✅ Better CI/CD integration

### For Users:
- ✅ Can run without installation
- ✅ Test builds without MSIX complexity
- ✅ Still get Store version when needed

### For the Project:
- ✅ Clearer separation of concerns
- ✅ More flexible deployment options
- ✅ Better development experience
- ✅ Maintains Store compatibility

## Questions?

If you have questions about the migration, please:
1. Check `PROJECT_STRUCTURE.md` for technical details
2. Review the updated `README.md` for building instructions
3. Open an issue on GitHub if you need help
