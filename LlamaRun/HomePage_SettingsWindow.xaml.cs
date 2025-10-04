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

        void Update_Model_ComboBox()
        {
            var models = DataStore.GetInstance().GetModels();

            if (models != null && models.Count > 0)
            {
                foreach (var model in models)
                {
                    var comboBoxItem = new ComboBoxItem
                    {
                        Content = model.Key
                    };
                    Model_ComboBox.Items.Add(comboBoxItem);
                }
            }

            if (!String.IsNullOrEmpty(DataStore.GetInstance().LoadSelectedModel().GetSelectedModel()))
            {
                var _selectedModel = DataStore.GetInstance().LoadSelectedModel().GetSelectedModel();
                DataStore.GetInstance().SetSelectedModel(_selectedModel);
                ComboBoxItem? comboBoxItem = null;
                _ = Model_ComboBox.Items.OfType<ComboBoxItem>().All(item =>
                {
                    if (string.Equals(item.Content.ToString(), _selectedModel))
                    {
                        comboBoxItem = item;
                        return false;
                    }
                    return true;
                });
                Model_ComboBox.SelectedItem = comboBoxItem;
            }
            else
            {
                Model_ComboBox.SelectedIndex = 0;
            }
        }

        private void MainWindowOpacitySlider_ValueChanged(object sender, RangeBaseValueChangedEventArgs e)
        {
            OpacityValueText.Text = $"{e.NewValue:F0}%";
        }

        public async void SaveButtonClicked(Object _, Object args)
        {
            // Get the selected model index from the ComboBox
            var selectedModelValue = Model_ComboBox.SelectedValue;
            ComboBoxItem? comboBoxItem = selectedModelValue?.As<ComboBoxItem>();
            if (selectedModelValue != null && comboBoxItem?.Content.As<String>().Length > 0)
            {
                var selectedModelIndex = Model_ComboBox.SelectedIndex;

                String selectedModel = DataStore.GetInstance().GetModels().ElementAt(selectedModelIndex).Key;

                DataStore.GetInstance().SetSelectedModel(selectedModel).SaveSelectedModel();
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
