using LlamaRun.MCPServers;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Linq;
using WinRT;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun;

/// <summary>
/// An empty page that can be used on its own or navigated to within a Frame.
/// </summary>
public sealed partial class MCPServerPage_SettingsWindow : Page
{
    public MCPServerPage_SettingsWindow()
    {
        this.InitializeComponent();
    }

    void MCPNavigationView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        var selectedItem = sender.SelectedItem.As<NavigationViewItem>().Tag as string;

        if (selectedItem == "InstalledMCPServers")
        {
            ContentFrame.Navigate(typeof(InstalledMCPServers), args.RecommendedNavigationTransitionInfo);
        }
        else if (selectedItem == "AvailableMCPServers")
        {
            ContentFrame.Navigate(typeof(AvaliableMCPServers), args.RecommendedNavigationTransitionInfo);
        }
    }

    void MCPNavigationView_Loaded(Object sender, RoutedEventArgs e)
    {
        NavView.SelectedItem = NavView.MenuItems.ElementAt(0);
    }
}
