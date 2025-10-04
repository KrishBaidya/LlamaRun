using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Linq;
using WinRT;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun
{
    /// <summary>
    /// An empty page that can be used on its own or navigated to within a Frame.
    /// </summary>
    public sealed partial class PluginPage_SettingsWindow : Page
    {
        public PluginPage_SettingsWindow()
        {
            this.InitializeComponent();
        }

        void PluginNavigationView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
        {
            var selectedItem = sender.SelectedItem.As<NavigationViewItem>().Tag as string;

            if (selectedItem == "InstalledPlugins")
            {
                ContentFrame.Navigate(typeof(InstalledPluginsPage), args.RecommendedNavigationTransitionInfo);
            }
            /*
            else if (selectedItem == L"AvailablePlugins")
            {
                ContentFrame().Navigate(winrt::xaml_typename<LlamaRun::AvailablePluginsPage>());
            }*/
        }

        void PluginNavigationView_Loaded(Object sender, RoutedEventArgs e)
        {
            NavView.SelectedItem = NavView.MenuItems.ElementAt(0);
        }
    }
}