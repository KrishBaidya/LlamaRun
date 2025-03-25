using CPythonIntrop;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Interop;
using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Foundation.Collections;
using Windows.Storage;
using Windows.Storage.Pickers;
using WinRT;
using WinRT.Interop;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun
{
    /// <summary>
    /// An empty page that can be used on its own or navigated to within a Frame.
    /// </summary>
    public sealed partial class InstalledPluginsPage : Page
    {
        public InstalledPluginsPage()
        {
            this.InitializeComponent();
        }

        async void InstalledPluginsList_Loaded(Object _, RoutedEventArgs __)
        {
            await PluginManagerIntrop.BroadcastEvent("");
            Binding binding = new()
            {
                Mode = BindingMode.TwoWay,
                Source = PluginManagerIntrop.Plugins()
            };
            InstalledPluginsList.SetBinding(ItemsControl.ItemsSourceProperty, binding);
        }

        async void Delete_Click(Object sender, RoutedEventArgs _)
        {
            var item = sender.As<MenuFlyoutItem>();
            if (item != null)
            {
                var plugin = item.DataContext.As<CPythonIntrop.Plugin>();
                if (plugin != null)
                {
                    ContentDialog removePluginDialog = new ContentDialog();
                    removePluginDialog.XamlRoot = this.XamlRoot;
                    removePluginDialog.Title = "Remove Plugin?";
                    removePluginDialog.PrimaryButtonText = "Yes";
                    removePluginDialog.CloseButtonText = "Cancel";
                    removePluginDialog.DefaultButton = ContentDialogButton.Primary;

                    removePluginDialog.PrimaryButtonClick += async (_, __) =>
                    {
                        int i = PluginManagerIntrop.Plugins().IndexOf(plugin);

                        try
                        {
                            await PluginManagerIntrop.RemovePlugin(plugin);
                            PluginManagerIntrop.Plugins().RemoveAt(i);
                        }
                        catch (Exception ex)
                        {
                            Debug.WriteLine(ex.Message);
                        }
                    };

                    var warningText = new TextBlock();
                    warningText.Text = "Do you really want to delete this Plugin";
                    removePluginDialog.Content = warningText;
                    var result = await removePluginDialog.ShowAsync();
                }
            }
        }

        private async void Install_From_Disk_Button_Click(Object sender, RoutedEventArgs __)
        {
            var senderButton = sender as Button;
            senderButton!.IsEnabled = false;

            FolderPicker openPicker = new();

            var window = App.m_window;

            // Retrieve the window handle (HWND) of the current WinUI 3 window.
            var hWnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

            // Initialize the folder picker with the window handle (HWND).
            WinRT.Interop.InitializeWithWindow.Initialize(openPicker, hWnd);

            // Set options for your folder picker
            openPicker.SuggestedStartLocation = PickerLocationId.Desktop;
            openPicker.FileTypeFilter.Add("*");

            // Open the picker for the user to pick a folder
            StorageFolder sourceFolder = await openPicker.PickSingleFolderAsync();

            if (sourceFolder == null)
            {
                Debug.WriteLine("No folder selected.");
                return;
            }

            StorageFolder pluginsFolder = await StorageFolder.GetFolderFromPathAsync(await PluginManagerIntrop.GetPluginsFolderPath());
            if (pluginsFolder == null)
            {
                Debug.WriteLine("Plugins folder not found.");
                return;
            }

            string sourceFolderName = sourceFolder.Name;

            // A clever way to check if Folder Exists
            try
            {
                await pluginsFolder.GetFolderAsync(sourceFolder.Path);
                Debug.WriteLine("A plugin with the name '" + sourceFolderName + "' is already installed.\n");
                return;
            }
            catch (Exception e)
            {
                Debug.WriteLine($"{e.Message}");
            }

            try
            {
                StorageFolder newDestinationFolder = await pluginsFolder.CreateFolderAsync(sourceFolder.Name, CreationCollisionOption.ReplaceExisting);
                await SettingsWindow.CopyFolderAsync(sourceFolder, newDestinationFolder);
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
            }

            Debug.WriteLine("Plugin '" + sourceFolderName + "' installed successfully.\n");

            await PluginManagerIntrop.LoadAllPlugins();
        }
    }
}