using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Windows.ApplicationModel.Activation;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun
{
    /// <summary>
    /// Provides application-specific behavior to supplement the default Application class.
    /// </summary>
    public partial class App : Application
    {
        /// <summary>
        /// Initializes the singleton application object.  This is the first line of authored code
        /// executed, and as such is the logical equivalent of main() or WinMain().
        /// </summary>
        public App()
        {
            this.InitializeComponent();

            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
            TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;

            // For WinUI3 specific exceptions
            this.UnhandledException += OnAppUnhandledException;
        }

        private void OnUnhandledException(object sender, System.UnhandledExceptionEventArgs e)
        {
            var ex = e.ExceptionObject as Exception;
            LogCrash("AppDomain.UnhandledException", ex);
        }

        private void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
        {
            LogCrash("UnobservedTaskException", e.Exception);
            e.SetObserved(); // Prevent app crash for now
        }

        private void OnAppUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
        {
            LogCrash("WinUI.UnhandledException", e.Exception);
            e.Handled = true; // Prevent immediate crash
        }

        private static void LogCrash(string source, Exception? ex)
        {
            var logPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LlamaRun",
                "crash.log");

            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);

                var logMessage = new StringBuilder();
                logMessage.AppendLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {source}");
                logMessage.AppendLine($"Exception Type: {ex?.GetType().FullName ?? "null"}");
                logMessage.AppendLine($"Message: {ex?.Message ?? "No message"}");
                logMessage.AppendLine($"HRESULT: {ex?.HResult:X8}");
                logMessage.AppendLine($"Stack Trace:\n{ex?.StackTrace ?? "No stack trace"}");

                if (ex?.InnerException != null)
                {
                    logMessage.AppendLine($"\nInner Exception: {ex.InnerException.GetType().FullName}");
                    logMessage.AppendLine($"Inner Message: {ex.InnerException.Message}");
                    logMessage.AppendLine($"Inner Stack:\n{ex.InnerException.StackTrace}");
                }

                logMessage.AppendLine(new string('=', 80));

                File.AppendAllText(logPath, logMessage.ToString());

                // Also write to debug output
                System.Diagnostics.Trace.WriteLine(logMessage.ToString());

                // Show message box in debug builds
#if DEBUG
            System.Diagnostics.Debug.WriteLine($"CRASH LOG: {logPath}");
#endif
            }
            catch
            {
                // Can't even log - we're in trouble
            }
        }


        private string? JWT;
        public event EventHandler<AuthenticationChangedEventArgs>? AuthenticationChanged = null;
        public Microsoft.Windows.AppLifecycle.AppInstance? mainInstance;

        /// <summary>
        /// Invoked when the application is launched.
        /// </summary>
        /// <param name="args">Details about the launch request and process.</param>
        protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
        {
            mainInstance = Microsoft.Windows.AppLifecycle.AppInstance.FindOrRegisterForKey("main");
            var activatedEventArgs =
                Microsoft.Windows.AppLifecycle.AppInstance.GetCurrent().GetActivatedEventArgs();

            //Avoid Creating multiple Instances of MainWindow
            if (!mainInstance.IsCurrent)
            {
                await mainInstance.RedirectActivationToAsync(activatedEventArgs);
                Process.GetCurrentProcess().Kill();
                return;
            }

            // Check for protocol activation
            if (activatedEventArgs.Kind == ExtendedActivationKind.Protocol)
            {
                IActivatedEventArgs? activatedArgs = activatedEventArgs.Data as IActivatedEventArgs;
                ProtocolActivatedEventArgs? protocolArgs = activatedArgs as ProtocolActivatedEventArgs;
                HandleProtocolActivation(protocolArgs!);
            }

            mainInstance.Activated += OnActivated;

            //DataStore.GetInstance().SetMCPServers(await SettingsWindow.LoadMCPServerData());

            var a = SettingsWindow.LoadSetting("isFirstRun");
            if (a == String.Empty)
            {
                a = bool.TrueString;
            }

            bool isFirstRun = bool.Parse(a);
            if (isFirstRun)
            {
                m_window = new FirstRunWindow();
                m_window.Activate();

                SettingsWindow.SaveSetting("isFirstRun", false);
            }
            else
            {
                m_window = new MainWindow();
                m_window.Activate();

                //SettingsWindow.SaveSetting("isFirstRun", true);
            }
        }

        private void OnActivated(object? sender, AppActivationArguments args)
        {
            Debug.WriteLine($"OnActivated (Main Instance): Kind = {args.Kind}");

            if (args.Kind == ExtendedActivationKind.Protocol)
            {
                Debug.WriteLine("Handling protocol activation in main instance.");
                var protocolArgs = args.Data as ProtocolActivatedEventArgs;
                HandleProtocolActivation(protocolArgs!);
            }
        }

        private void HandleProtocolActivation(ProtocolActivatedEventArgs args)
        {
            if (args.Uri.Scheme == "llama-run")
            {
                string query = args.Uri.Query;
                JWT = ParseJwtFromQuery(query);

                if (!string.IsNullOrEmpty(JWT))
                {
                    DataStore.GetInstance().SetJWT(JWT).SaveJWT();
                    Debug.WriteLine($"JWT received: {JWT}");
                    AuthenticationChanged?.Invoke(this, new AuthenticationChangedEventArgs(true));
                }
                else
                {
                    Debug.WriteLine("Error: JWT is missing or invalid in the protocol activation.");
                    // Optionally show an error message to the user.
                }
            }
        }

        private string ParseJwtFromQuery(string query)
        {
            var parameters = System.Web.HttpUtility.ParseQueryString(query);
            return parameters["token"]!;
        }

        public void OnAuthenticationChanged(bool isAuthenticated)
        {
            AuthenticationChanged?.Invoke(this, new AuthenticationChangedEventArgs(isAuthenticated));
        }

        public static Window? m_window = new();
    }


    public class AuthenticationChangedEventArgs(bool isAuthenticated) : EventArgs
    {
        public bool IsAuthenticated { get; } = isAuthenticated;
    }
}