using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http.Headers;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using Microsoft.UI.Xaml.Shapes;
using Microsoft.Windows.AppLifecycle;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.Foundation;
using Windows.Foundation.Collections;
using Windows.Web.Http;
using WinRT;

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

            var a = SettingsWindow.LoadSetting("isFirstRun");
            if (a == "")
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

        private Window? m_window;
    }


    public class AuthenticationChangedEventArgs(bool isAuthenticated) : EventArgs
    {
        public bool IsAuthenticated { get; } = isAuthenticated;
    }
}
