using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using System;
using System.Linq;
using System.Threading.Tasks;
using Windows.ApplicationModel;
using WinRT;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun
{
    /// <summary>
    /// An empty page that can be used on its own or navigated to within a Frame.
    /// </summary>
    public sealed partial class HomePage_SettingsWindow : Page
    {
        public bool IsAuth = false;

        public HomePage_SettingsWindow()
        {
            this.InitializeComponent();

            CheckInitialAuthStatus(); // Call a new method to check initial status
        }

        private void CheckInitialAuthStatus()
        {
            string? jwt = DataStore.GetInstance().LoadJWT().GetJWT();
            IsAuth = !string.IsNullOrEmpty(jwt); // Set initial IsAuth based on JWT presence
        }

        static async Task<bool> CheckStartUp()
        {
            var startupTask = await StartupTask.GetAsync("LlamaRun Generation");

            switch (startupTask.State)
            {
                case StartupTaskState.Disabled:
                    return false;

                case StartupTaskState.DisabledByUser:
                    return false;

                case StartupTaskState.DisabledByPolicy:
                    return false;

                case StartupTaskState.Enabled:
                    return true;

                case StartupTaskState.EnabledByPolicy:
                    return true;
            }

            return false;
        }

        public async void rootPanel_Loaded(Object sender, RoutedEventArgs e)
        {
            //if (SettingsWindow.LoadSetting("Width") != "")
            //{
            //    var appWidth = SettingsWindow.LoadSetting("Width");

            //    MainWindowWidth.Value = double.Parse(appWidth);
            //}
            //else
            //{
            //    MainWindowWidth.Value = 38;
            //}

            //if (SettingsWindow.LoadSetting("Height") != "")
            //{
            //    var appHeight = SettingsWindow.LoadSetting("Height");

            //    MainWindowHeight.Value = double.Parse(appHeight);
            //}
            //else
            //{
            //    MainWindowHeight.Value = 10;
            //}

            if (SettingsWindow.LoadSetting("AppOpacity") != String.Empty)
            {
                var appOpacity = SettingsWindow.LoadSetting("AppOpacity");

                MainWindowOpacitySlider.Value = double.Parse(appOpacity);
            }

            else
            {
                MainWindowOpacitySlider.Value = 15;
            }

            if (SettingsWindow.LoadSetting("Startup Enabled") != String.Empty)
            {
                var StartupEnabled = SettingsWindow.LoadSetting("Startup Enabled");
                _ = bool.TryParse(StartupEnabled, out bool _StartupEnabled);
                AutoStartUpCheckBox.IsChecked = _StartupEnabled;
            }

            else
            {
                bool _StartUpEnabled = await CheckStartUp();
                AutoStartUpCheckBox.IsChecked = _StartUpEnabled;
            }
        }

        public void Model_ComboBox_Loaded(Object _, Object __)
        {
            Update_Model_ComboBox();
        }

        async Task RequestStartupChange(bool Enable)
        {
            var startupTask = await StartupTask.GetAsync("LlamaRun Generation");

            if (Enable)
            {
                await startupTask.RequestEnableAsync();
            }
            else
            {
                startupTask.Disable();
            }
        }

        async void Update_Model_ComboBox()
        {

            Model_ComboBox.Items.Clear();
            string savedModelId = DataStore.GetInstance().LoadSelectedModel().GetSelectedModel();
            ComboBoxItem? itemToSelect = null;

            // 1. GEMINI (Static)
            foreach (var provider in Models.models)
            {
                Model_ComboBox.Items.Add(new ComboBoxItem { Content = $"--- {provider.Key} ---", IsEnabled = false, Opacity = 0.5 });
                foreach (var model in provider.Value.Models)
                {
                    var item = new ComboBoxItem { Content = model.Key, Tag = model.Value };
                    Model_ComboBox.Items.Add(item);
                    if (model.Value.Name == savedModelId) itemToSelect = item;
                }
            }

            // 2. OLLAMA (Dynamic)
            Model_ComboBox.Items.Add(new ComboBoxItem { Content = "--- Ollama (Local) ---", IsEnabled = false, Opacity = 0.5 });

            // Fetch generic 'Model' objects from OllamaService
            var localModels = await OllamaService.GetAvailableModels();

            if (localModels.Count == 0)
            {
                Model_ComboBox.Items.Add(new ComboBoxItem { Content = "(Ollama not running)", IsEnabled = false });
            }
            else
            {
                foreach (var m in localModels)
                {
                    var item = new ComboBoxItem { Content = m.Name, Tag = m.Name };
                    Model_ComboBox.Items.Add(item);
                    if (m.Name == savedModelId) itemToSelect = item;
                }
            }

            // 3. Selection Logic
            if (itemToSelect != null) Model_ComboBox.SelectedItem = itemToSelect;
            else if (Model_ComboBox.Items.Count > 1) Model_ComboBox.SelectedIndex = 1;
        }

        private void MainWindowOpacitySlider_ValueChanged(object sender, RangeBaseValueChangedEventArgs e)
        {
            OpacityValueText.Text = $"{e.NewValue:F0}%";
        }

        public async void SaveButtonClicked(Object _, Object args)
        {
            // Get the selected model index from the ComboBox
            var selectedModelValue = Model_ComboBox.SelectedValue;
            if (Model_ComboBox.SelectedItem is ComboBoxItem item && item.Tag is string modelId)
            {
                DataStore.GetInstance().SetSelectedModel(modelId).SaveSelectedModel();
            }

            // Retrieve the current height, width, and opacity values from the UI elements
            //var AppHeight = MainWindowHeight.Value;
            //var AppWidth = MainWindowWidth.Value;
            var AppOpacity = MainWindowOpacitySlider.Value;

            // Set and save the new app opacity
            DataStore.GetInstance().SetAppOpacity((float)AppOpacity).SaveAppOpacity();

            // Set and save the new app dimensions (height and width)
            //DataStore.GetInstance().SetAppDimension(new System.Drawing.Point((int)AppWidth, (int)AppHeight)).SaveAppDimension();

            // Handle AutoStartUp check box state
            bool autoStartupEnabled = AutoStartUpCheckBox.IsChecked ?? false;
            await RequestStartupChange(autoStartupEnabled);

            // Save startup setting state in DataStore
            SettingsWindow.SaveSetting("Startup Enabled", autoStartupEnabled);
        }
    }
}
