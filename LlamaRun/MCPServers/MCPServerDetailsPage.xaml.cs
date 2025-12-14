using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Diagnostics;
using System.Linq;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun.MCPServers
{
    /// <summary>
    /// An empty page that can be used on its own or navigated to within a Frame.
    /// </summary>
    public sealed partial class MCPServerDetailsPage : Page
    {
        MCPServerInfo serverInfo = new();

        public MCPServerDetailsPage()
        {
            InitializeComponent();
        }

        protected override async void OnNavigatedTo(Microsoft.UI.Xaml.Navigation.NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);

            if (e.Parameter is MCPServerInfo server)
            {
                serverInfo = server;

                Debug.WriteLine(server.id);
                ServerNameTextBlock.Text = server.name;
                ServerDescriptionTextBlock.Text = server.description;
                ServerAuthorTextBlock.Text = server.author;
                ServerCategoryTextBlock.Text = server.category;

                if (server.tags != null && server.tags.Length != 0)
                {
                    ServerTagsTextBlock.Text = string.Join(", ", server.tags);
                }
                else
                {
                    ServerTagsTextBlock.Text = string.Empty; // or "No tags"
                }
                if (server.repositoryUrl != null)
                {
                    await ReadmeViewer.LoadHtmlContent($"{Constants.BaseMCPDirectoryUrl}/server_readme/{server.id}");
                }
            }
        }

        private async void Install_Button_Click(object sender, RoutedEventArgs e)
        {
            var newMCPServer = serverInfo.ToMCPServer();

            // Load existing config
            var existingServers = await SettingsWindow.LoadMCPServerData();
            var combinedServers = existingServers.Concat(new[] { newMCPServer }).ToList();

            // Show editable JSON preview dialog
            var dialog = new ConfigPreviewDialog(combinedServers)
            {
                XamlRoot = this.XamlRoot
            };

            var result = await dialog.ShowAsync();
            if (result == ContentDialogResult.Primary)
            {
                // Parse the updated JSON into server objects
                var updatedServers = dialog.GetUpdatedServers();
                if (updatedServers != null)
                {
                    await SettingsWindow.SaveMCPServerData(updatedServers);
                }
            }
        }

        private void Card_Border_ActualThemeChanged(FrameworkElement sender, object args)
        {
            if (sender is Border border)
            {
                if (border.ActualTheme == ElementTheme.Light)
                {
                    border.Background.Opacity = 0.08;
                }
                else
                {
                    border.Background.Opacity = 0.8;
                }
            }
        }

        private void Card_Border_Loaded(object sender, RoutedEventArgs e)
        {
            if (sender is Border border)
            {
                if (border.ActualTheme == ElementTheme.Light)
                {
                    border.Background.Opacity = 0.08;
                }
                else
                {
                    border.Background.Opacity = 0.8;
                }
            }
        }

        private void BackButton_Click(object sender, RoutedEventArgs e)
        {
            if (Frame.CanGoBack)
            {
                Frame.GoBack();
            }
        }
    }
}
