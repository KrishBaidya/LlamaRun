using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Threading.Tasks;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun.MCPServers
{
    public sealed partial class ReadmeViewer : UserControl
    {
        public ReadmeViewer()
        {
            this.InitializeComponent();
            this.Loaded += OnLoaded;
        }

        private async void OnLoaded(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            try
            {
                // Initialize WebView2 when control is loaded
                await ReadmeWebView.EnsureCoreWebView2Async();

                System.Diagnostics.Debug.WriteLine("WebView2 should now display test content");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"WebView2 initialization failed: {ex.Message}");
            }
        }

        public async Task LoadHtmlContent(string URL)
        {
            try
            {
                // Make sure WebView2 is ready
                await ReadmeWebView.EnsureCoreWebView2Async();

                ReadmeWebView.CoreWebView2.Profile.PreferredColorScheme = Microsoft.Web.WebView2.Core.CoreWebView2PreferredColorScheme.Auto;
                ReadmeWebView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                ReadmeWebView.CoreWebView2.Navigate(URL);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to load HTML: {ex.Message}");
            }
        }

        private void ReadmeWebView_NavigationStarting(object sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationStartingEventArgs e)
        {
            // Show loading state
            LoadingPanel.Visibility = Visibility.Visible;
            ErrorPanel.Visibility = Visibility.Collapsed;
        }

        private void ReadmeWebView_NavigationCompleted(object sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e)
        {
            LoadingPanel.Visibility = Visibility.Collapsed;

            // Show error state if navigation failed
            if (!e.IsSuccess)
            {
                ErrorPanel.Visibility = Visibility.Visible;
            }
            else
            {
                ErrorPanel.Visibility = Visibility.Collapsed;
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e)
        {
            ErrorPanel.Visibility = Visibility.Collapsed;

            ReadmeWebView.Reload();
        }
    }
}
