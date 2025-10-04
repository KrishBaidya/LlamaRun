using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Newtonsoft.Json;
using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Windows.Web.Http;

namespace LlamaRun.MCPServers
{
    public sealed partial class AvaliableMCPServers : Page
    {
        public ObservableCollection<MCPServerInfo> MCPServers { get; } = [];

        //Limit for fetcing MCP Servers
        readonly int limit = 12;
        private string? _nextCursor = null;
        private bool _isLoading = false;
        private bool _hasMore = true;
        private string _currentSearchQuery = string.Empty;
        private System.Threading.Timer? _searchDebounceTimer;

        public AvaliableMCPServers()
        {
            InitializeComponent();
        }

        private async void AvaliableMCPList_Loaded(object sender, RoutedEventArgs e)
        {
            if (sender is ListView listView)
            {
                // Get the internal ScrollViewer
                if (VisualTreeHelper.GetChild(listView, 0) is Border border &&
                    VisualTreeHelper.GetChild(border, 0) is ScrollViewer scrollViewer)
                {
                    scrollViewer.ViewChanged += ScrollViewer_ViewChanged;
                }
            }

            MCPServers.Clear();
            _nextCursor = null;
            _hasMore = true;
            _currentSearchQuery = string.Empty;
            await LoadServersAsync();
        }

        private async Task LoadServersAsync(bool isLoadMore = false)
        {
            if (_isLoading || (!isLoadMore && !_hasMore))
                return;

            if (!isLoadMore)
            {
                _nextCursor = null;
                _hasMore = true;
                MCPServers.Clear();
            }

            _isLoading = true;

            // Show initial overlay if first load or new search
            if (MCPServers.Count == 0)
                InitialLoadingOverlay.Visibility = Visibility.Visible;
            else if (isLoadMore)
                LoadingSpinnerBottom.Visibility = Visibility.Visible;

            var httpClient = new HttpClient();
            try
            {
                var url = $"{Constants.BaseMCPDirectoryUrl}/api/servers?limit={limit}";

                // Add search query if present
                if (!string.IsNullOrWhiteSpace(_currentSearchQuery))
                    url += $"&search={Uri.EscapeDataString(_currentSearchQuery)}";

                // Add cursor for pagination
                if (!string.IsNullOrEmpty(_nextCursor))
                    url += $"&cursorId={_nextCursor}";

                var response = await httpClient.GetStringAsync(new Uri(url));
                var servers = JsonConvert.DeserializeObject<MCPServerResponse>(response);

                if (servers?.Servers != null)
                {
                    foreach (var server in servers.Servers)
                        MCPServers.Add(server);
                }

                if (!string.IsNullOrEmpty(servers?.NextCursor))
                {
                    _nextCursor = servers.NextCursor;
                    _hasMore = true;
                }
                else
                {
                    _hasMore = false;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
            }
            finally
            {
                _isLoading = false;
                InitialLoadingOverlay.Visibility = Visibility.Collapsed;
                LoadingSpinnerBottom.Visibility = Visibility.Collapsed;
            }
        }

        // Push to the MCP Server Details page.
        private void AvaliableMCPList_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is MCPServerInfo server)
            {
                Frame.Navigate(typeof(MCPServerDetailsPage), server);
            }
        }

        private async void ScrollViewer_ViewChanged(object sender, ScrollViewerViewChangedEventArgs e)
        {
            if (sender is ScrollViewer scrollViewer)
            {
                // Trigger only when near bottom, and avoid extra calls
                if (scrollViewer.VerticalOffset >= scrollViewer.ScrollableHeight - 100)
                {
                    await LoadServersAsync(isLoadMore: true);
                }
            }
        }

        private void Card_PointerEntered(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
        {
            if (sender is UserControl userControl)
            {
                var border = userControl.Content as Border;
                if (border != null)
                {
                    // Use theme-aware hover color
                    border.Background = (Brush)Application.Current.Resources["CardBackgroundFillColorSecondaryBrush"];
                }
            }
        }

        private void Card_PointerExited(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
        {
            if (sender is UserControl userControl)
            {
                var border = userControl.Content as Border;
                if (border != null)
                {
                    // Return to original theme-aware color
                    border.Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"];
                }
            }
        }

        private void MCPSearchBox_TextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
        {
            // Only process user input, not programmatic changes
            if (args.Reason == AutoSuggestionBoxTextChangeReason.UserInput)
            {
                var searchQuery = sender.Text?.Trim() ?? string.Empty;

                // Debounce the search to avoid too many API calls
                _searchDebounceTimer?.Dispose();
                _searchDebounceTimer = new System.Threading.Timer(_ =>
                {
                    DispatcherQueue.TryEnqueue(async () =>
                    {
                        _currentSearchQuery = searchQuery;
                        await PerformSearch();
                    });
                }, null, TimeSpan.FromMilliseconds(Constants.ServerDebounceTime).Seconds, Timeout.InfiniteTimeSpan.Seconds);
            }
        }

        private async Task PerformSearch()
        {
            // Reset pagination for new search
            _nextCursor = null;
            _hasMore = true;

            // Load servers with the new search query
            await LoadServersAsync(isLoadMore: false);
        }
    }
}