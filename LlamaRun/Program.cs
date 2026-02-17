using System;
using System.Runtime.InteropServices;
using System.Diagnostics;

namespace LlamaRun
{
    public static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                // Initialize COM wrappers for WinRT support
                WinRT.ComWrappersSupport.InitializeComWrappers();

                // Start the WinUI 3 application
                Microsoft.UI.Xaml.Application.Start((p) =>
                {
                    var context = new Microsoft.UI.Dispatching.DispatcherQueueSynchronizationContext(
                        Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread());
                    System.Threading.SynchronizationContext.SetSynchronizationContext(context);
                    new App();
                });
            }
            catch (Exception ex)
            {
                // Log the error for debugging
                string errorMessage = $"Application failed to start: {ex.Message}\n\nStack Trace:\n{ex.StackTrace}";
                
                if (ex.InnerException != null)
                {
                    errorMessage += $"\n\nInner Exception: {ex.InnerException.Message}\n{ex.InnerException.StackTrace}";
                }

                // Write to debug output
                Debug.WriteLine(errorMessage);

                // Also write to a log file
                try
                {
                    string logDir = System.IO.Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "LlamaRun");
                    string logPath = System.IO.Path.Combine(logDir, "crash.log");
                    
                    System.IO.Directory.CreateDirectory(logDir);
                    System.IO.File.WriteAllText(logPath, $"{DateTime.Now}: {errorMessage}");
                }
                catch
                {
                    // Ignore file write errors
                }

                // Show error dialog
                MessageBox(IntPtr.Zero, errorMessage, "LlamaRun - Startup Error", 0x10);
                
                Environment.Exit(1);
            }
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);
    }
}
