using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using ModelContextProtocol.Protocol;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun.MCPServers
{
    /// <summary>
    /// An empty page that can be used on its own or navigated to within a Frame.
    /// </summary>
    public sealed partial class InstalledMCPServers : Page
    {
        public ObservableCollection<Tuple<MCP_Server, string>> FilteredServers { get; set; } = new();

        private List<Tuple<MCP_Server, string>> _allServers = new();

        public InstalledMCPServers()
        {
            this.InitializeComponent();
        }

        private void InstalledMCPList_Loaded(object sender, RoutedEventArgs e)
        {
            LoadServers();
        }

        private async void LoadServers()
        {
            var getTools = await SettingsWindow.LoadMCPServerData();
            DataStore.GetInstance().SetMCPServers(getTools);

            _allServers = DataStore.GetInstance().GetMCPServers()
                    .Select(m => new Tuple<MCP_Server, string>(
                        m,
                        string.Join(" ", m.Data.Arguments ?? new List<string>())
                    ))
                    .ToList();

            PerformSearch("");
        }

        private void PerformSearch(string query)
        {
            FilteredServers.Clear();

            var matches = string.IsNullOrWhiteSpace(query)
                ? _allServers
                : _allServers.Where(s =>
                    s.Item1.Name.Contains(query, StringComparison.OrdinalIgnoreCase));

            foreach (var server in matches)
            {
                FilteredServers.Add(server);
            }
        }

        // Event handler for AutoSuggestBox
        private void SearchBox_TextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
        {
            PerformSearch(sender.Text);
        }

        private async void RemoveServer_Click(object sender, RoutedEventArgs e)
        {
            var button = sender as Button;
            if (button?.DataContext is Tuple<MCP_Server, string> itemToRemove)
            {
                ContentDialog deleteDialog = new ContentDialog
                {
                    XamlRoot = this.XamlRoot,
                    Title = "Remove Server?",
                    Content = $"Are you sure you want to remove '{itemToRemove.Item1.Name}'?",
                    PrimaryButtonText = "Remove",
                    CloseButtonText = "Cancel",
                    DefaultButton = ContentDialogButton.Close,
                    PrimaryButtonStyle = (Style)Application.Current.Resources["AccentButtonStyle"] // Optional styling
                };

                var result = await deleteDialog.ShowAsync();

                if (result == ContentDialogResult.Primary)
                {
                    FilteredServers.Remove(itemToRemove);
                    _allServers.Remove(itemToRemove);

                    var updatedServerList = _allServers.Select(x => x.Item1).ToList();

                    DataStore.GetInstance().SetMCPServers(updatedServerList);

                    try
                    {
                        await SettingsWindow.SaveMCPServerData(updatedServerList);
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"Failed to save servers: {ex.Message}");
                    }
                }
            }
        }
    }
}
