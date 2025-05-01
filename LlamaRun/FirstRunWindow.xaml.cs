using Microsoft.UI.Xaml;
using System;

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

            Title = "Get Started - Llama Run";

            ExtendsContentIntoTitleBar = true;

            RequestStartup();
        }

        void UpdateStep()
        {
            // Update the step title and description based on current step
            switch (currentStep)
            {
                case 0:
                    StepTitle.Text = "Step 1: AI Answers";
                    StepDescription.Text = "Instantly get answers to programming questions and tech problems.";
                    break;
                case 1:
                    StepTitle.Text = "Step 2: Hotkey Activation";
                    StepDescription.Text = "Wake LlamaRun with a hotkey, ready to assist anytime. Just Press Ctrl + Shift + A";
                    break;
                case 2:
                    StepTitle.Text = "Step 3: Lightweight & Always On";
                    StepDescription.Text = "LlamaRun starts with your PC, so you always have AI assistance at your fingertips.";
                    break;
            }

            // Update progress bar
            ProgressIndicator.Value = currentStep * 100.0 / 2.0;

            // Enable/disable buttons
            PreviousButton.IsEnabled = (currentStep > 0);
            NextButton.IsEnabled = (currentStep < 2);
        }

        public void Previous_Click(Object _, Object __)
        {
            if (currentStep > 0)
            {
                currentStep--;
                UpdateStep();
            }
        }

        public void Next_Click(Object _, Object __)
        {
            if (currentStep < 2)
            {
                currentStep++;
                UpdateStep();
            }
        }

        public void Finish_Click(Object _, Object __)
        {
            var window = new LlamaRun.MainWindow();
            App.m_window = window;
            window.Activate();

            this.Close();
        }

        async void RequestStartup()
        {
            var startupTask = await Windows.ApplicationModel.StartupTask.GetAsync("LlamaRun Generation");

            switch (startupTask.State)
            {
                case Windows.ApplicationModel.StartupTaskState.Disabled:
                    await startupTask.RequestEnableAsync();
                    break;

                case Windows.ApplicationModel.StartupTaskState.DisabledByUser:
                    await startupTask.RequestEnableAsync();
                    break;

                case Windows.ApplicationModel.StartupTaskState.DisabledByPolicy:
                    // Startup disabled by group policy
                    break;

                case Windows.ApplicationModel.StartupTaskState.Enabled:
                    // Already enabled
                    break;
            }
        }

        public void Grid_Loaded(Object _, Object __)
        {
            UpdateStep();
        }

    }
}
