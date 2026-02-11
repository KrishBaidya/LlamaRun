using System;
using System.Threading.Tasks;
using Windows.ApplicationModel;
using Microsoft.Win32;

namespace LlamaRun
{
    /// <summary>
    /// Represents the state of the startup task
    /// </summary>
    public enum StartupState
    {
        Disabled,
        DisabledByUser,
        DisabledByPolicy,
        Enabled,
        EnabledByPolicy
    }

    /// <summary>
    /// Interface for managing application startup behavior
    /// </summary>
    public interface IStartupService
    {
        Task<StartupState> GetStateAsync();
        Task<bool> RequestEnableAsync();
        Task DisableAsync();
    }

    /// <summary>
    /// Startup service for packaged apps using StartupTask
    /// </summary>
    public class PackagedStartupService : IStartupService
    {
        private const string TaskId = "LlamaRun Generation";

        public async Task<StartupState> GetStateAsync()
        {
            try
            {
                var startupTask = await StartupTask.GetAsync(TaskId);
                
                return startupTask.State switch
                {
                    StartupTaskState.Disabled => StartupState.Disabled,
                    StartupTaskState.DisabledByUser => StartupState.DisabledByUser,
                    StartupTaskState.DisabledByPolicy => StartupState.DisabledByPolicy,
                    StartupTaskState.Enabled => StartupState.Enabled,
                    StartupTaskState.EnabledByPolicy => StartupState.EnabledByPolicy,
                    _ => StartupState.Disabled
                };
            }
            catch
            {
                return StartupState.Disabled;
            }
        }

        public async Task<bool> RequestEnableAsync()
        {
            try
            {
                var startupTask = await StartupTask.GetAsync(TaskId);
                var result = await startupTask.RequestEnableAsync();
                
                return result == StartupTaskState.Enabled || 
                       result == StartupTaskState.EnabledByPolicy;
            }
            catch
            {
                return false;
            }
        }

        public async Task DisableAsync()
        {
            try
            {
                var startupTask = await StartupTask.GetAsync(TaskId);
                startupTask.Disable();
            }
            catch
            {
                // Failed to disable - already disabled or not available
            }
        }
    }

    /// <summary>
    /// Startup service for unpackaged apps using Windows Registry
    /// </summary>
    public class UnpackagedStartupService : IStartupService
    {
        private const string AppName = "LlamaRun";
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        private string GetExecutablePath()
        {
            // Try ProcessPath first (works for .NET 5+ including single-file deployments)
            if (!string.IsNullOrEmpty(Environment.ProcessPath))
                return Environment.ProcessPath;

            // Fallback to MainModule.FileName
            var mainModulePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName;
            if (!string.IsNullOrEmpty(mainModulePath))
                return mainModulePath;

            // Last resort: Assembly location (won't work for single-file deployments)
            return System.Reflection.Assembly.GetExecutingAssembly().Location;
        }

        public Task<StartupState> GetStateAsync()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, false))
                {
                    if (key != null)
                    {
                        var value = key.GetValue(AppName) as string;
                        if (!string.IsNullOrEmpty(value))
                        {
                            return Task.FromResult(StartupState.Enabled);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to check startup state: {ex.Message}");
            }

            return Task.FromResult(StartupState.Disabled);
        }

        public Task<bool> RequestEnableAsync()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key != null)
                    {
                        var exePath = GetExecutablePath();
                        key.SetValue(AppName, $"\"{exePath}\"");
                        return Task.FromResult(true);
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to enable startup: {ex.Message}");
            }

            return Task.FromResult(false);
        }

        public Task DisableAsync()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key != null)
                    {
                        if (key.GetValue(AppName) != null)
                        {
                            key.DeleteValue(AppName, false);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to disable startup: {ex.Message}");
            }

            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// Factory to create the appropriate startup service based on packaging status
    /// </summary>
    public static class StartupServiceFactory
    {
        private static IStartupService? _instance;

        public static IStartupService GetStartupService()
        {
            if (_instance != null)
                return _instance;

            // Try to detect if app is packaged
            try
            {
                // This will throw if app is unpackaged
                var _ = Windows.ApplicationModel.Package.Current;
                _instance = new PackagedStartupService();
            }
            catch
            {
                // App is unpackaged - use registry-based startup
                _instance = new UnpackagedStartupService();
            }

            return _instance;
        }
    }
}
