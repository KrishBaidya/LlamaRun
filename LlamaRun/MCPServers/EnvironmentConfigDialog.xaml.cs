using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.Generic;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun.MCPServers
{
    public sealed partial class EnvironmentConfigDialog : ContentDialog
    {
        public Dictionary<string, string> EnvironmentVariables { get; private set; }
        private readonly Dictionary<string, TextBox> _inputControls = new();

        public EnvironmentConfigDialog(Dictionary<string, string> envVars)
        {
            this.InitializeComponent();
            EnvironmentVariables = new Dictionary<string, string>(envVars);
            CreateInputFields();
        }

        private void CreateInputFields()
        {
            foreach (var envVar in EnvironmentVariables)
            {
                var container = new StackPanel { Spacing = 4 };

                // Variable name with required indicator
                var namePanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
                namePanel.Children.Add(new TextBlock
                {
                    Text = envVar.Key,
                    FontWeight = FontWeights.SemiBold
                });

                container.Children.Add(namePanel);

                // Input field
                var textBox = new TextBox
                {
                    PlaceholderText = GetPlaceholder(envVar.Key, envVar.Value),
                    Text = IsPlaceholder(envVar.Value) ? String.Empty : envVar.Value
                };

                // Use PasswordBox for sensitive variables
                FrameworkElement inputControl;
                _inputControls[envVar.Key] = textBox;
                inputControl = textBox;

                container.Children.Add(inputControl);
                EnvVarsPanel.Children.Add(container);
            }
        }

        private void ContentDialog_PrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
        {
            // Update environment variables with user input
            foreach (var kvp in _inputControls)
            {
                var value = kvp.Value.Text;
                if (!string.IsNullOrEmpty(value))
                {
                    EnvironmentVariables[kvp.Key] = value;
                }
            }
        }

        private bool IsPlaceholder(string value)
        {
            return string.IsNullOrEmpty(value) || value.StartsWith("<") && value.EndsWith(">");
        }

        private string GetPlaceholder(string key, string defaultValue)
        {
            if (IsPlaceholder(defaultValue))
            {
                return $"Enter your {key.ToLower().Replace('_', ' ')}";
            }
            return defaultValue;
        }
    }
}
