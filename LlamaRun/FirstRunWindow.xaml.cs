using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System;
using System.Linq;
using Windows.System;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun
{
    /// <summary>
    /// An empty window that can be used on its own or navigated to within a Frame.
    /// </summary>
    public sealed partial class FirstRunWindow : Window
    {
        int currentStep = 0;

        public FirstRunWindow()
        {
            this.InitializeComponent();
            Title = "Welcome to Llama Run";
            ExtendsContentIntoTitleBar = true;

            ((App)Application.Current).AuthenticationChanged += OnAuthenticationChanged;

            UpdateUI();
        }

        private void UpdateUI()
        {
            PipsPagerControl.SelectedPageIndex = currentStep;

            Step1Panel.Visibility = (currentStep == 0) ? Visibility.Visible : Visibility.Collapsed;
            Step2Panel.Visibility = (currentStep == 1) ? Visibility.Visible : Visibility.Collapsed;
            Step3Panel.Visibility = (currentStep == 2) ? Visibility.Visible : Visibility.Collapsed;
            Step4Panel.Visibility = (currentStep == 3) ? Visibility.Visible : Visibility.Collapsed;

            if (currentStep == 3)
            {
                PreviousButton.Visibility = Visibility.Collapsed;
                NextButton.Visibility = Visibility.Collapsed;
            }
            else
            {
                PreviousButton.Visibility = Visibility.Visible;
                NextButton.Visibility = Visibility.Visible;

                PreviousButton.IsEnabled = (currentStep > 0);
                NextButton.Content = "Next";
            }
        }

        public void Previous_Click(object sender, RoutedEventArgs e)
        {
            if (currentStep > 0)
            {
                currentStep--;
                UpdateUI();
            }
        }

        public void Next_Click(object sender, RoutedEventArgs e)
        {
            if (currentStep < 3) // Updated to 3
            {
                currentStep++;
                UpdateUI();
            }
        }


        private void Finish_Sequence()
        {
            // Open Main Window
            var window = new LlamaRun.MainWindow();
            App.m_window = window;
            window.Activate();

            // Close this onboarding window
            this.Close();
        }

        private void PipsPagerControl_SelectedIndexChanged(PipsPager sender, PipsPagerSelectedIndexChangedEventArgs args)
        {
            currentStep = sender.SelectedPageIndex;
            UpdateUI();
        }

        private async void OnAuthenticationChanged(object? sender, AuthenticationChangedEventArgs e)
        {
            DispatcherQueue.TryEnqueue(async () =>
            {
                if (e.IsAuthenticated)
                {
                    var loadingText = LoadingPanel.Children.OfType<TextBlock>().FirstOrDefault();
                    if (loadingText != null)
                    {
                        loadingText.Text = "Setting up your profile...";
                    }

                    try
                    {
                        string jwt = DataStore.GetInstance().GetJWT();
                        if (!string.IsNullOrEmpty(jwt))
                        {
                            await SettingsWindow.FetchAndSaveUserInfo(jwt);
                        }
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine("Profile fetch failed: " + ex.Message);
                    }

                    Finish_Sequence();
                }
            });
        }

        private async void SignIn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                // 1. Switch UI to Loading State
                ActionButtonsPanel.Visibility = Visibility.Collapsed;
                LoadingPanel.Visibility = Visibility.Visible;

                // 2. Launch Browser
                await Launcher.LaunchUriAsync(new Uri(Constants.BaseServerUrl + "/login"));

                // 3. DO NOT call Finish_Sequence(). 
                // We now wait for OnAuthenticationChanged to fire.
            }
            catch (Exception)
            {
                // If launch fails, revert UI
                CancelLogin_Click(null, null);
            }
        }

        private void CancelLogin_Click(object? sender, RoutedEventArgs? e)
        {
            // Revert UI if user cancels
            LoadingPanel.Visibility = Visibility.Collapsed;
            ActionButtonsPanel.Visibility = Visibility.Visible;
        }

        private void Skip_Click(object sender, RoutedEventArgs e)
        {
            // User chose local mode explicitly
            Finish_Sequence();
        }

        // Ensure we unsubscribe to avoid memory leaks (though Window is closing anyway)
        private void Window_Closed(object sender, WindowEventArgs args)
        {
            ((App)Application.Current).AuthenticationChanged -= OnAuthenticationChanged;
        }

    }
}