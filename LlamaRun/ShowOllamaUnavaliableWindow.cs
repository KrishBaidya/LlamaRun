using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using WinRT;

namespace LlamaRun
{
    internal class ShowOllamaUnavaliableWindow
    {
        private static ShowOllamaUnavaliableWindow? instance = null;
        public static ShowOllamaUnavaliableWindow GetInstance()
        {
            instance ??= new ShowOllamaUnavaliableWindow();
            return instance;
        }

        public void ShowOllamaDialog()
        {
            var newWindow = new Window();
            newWindow.AppWindow.Resize(new Windows.Graphics.SizeInt32(500, 300));

            // Create a Grid container
            Grid grid = new();

            // Define rows for the Grid
            RowDefinition rowDef1 = new()
            {
                Height = new GridLength(1, GridUnitType.Star) // Auto-size row for messageText
            };
            grid.RowDefinitions.Add(rowDef1);

            RowDefinition rowDef2 = new()
            {
                Height = new GridLength(1, GridUnitType.Auto) // Auto-size row for ollamaLink
            };
            grid.RowDefinitions.Add(rowDef2);

            RowDefinition rowDef3 = new()
            {
                Height = new GridLength(1, GridUnitType.Star) // Take remaining space for layout flexibility
            };
            grid.RowDefinitions.Add(rowDef3);

            RowDefinition rowDef4 = new()
            {
                Height = new GridLength(1, GridUnitType.Auto) // Auto-size row for closeButton
            };
            grid.RowDefinitions.Add(rowDef4);

            // Create the messageText block
            TextBlock messageText = new()
            {
                Text = "Ollama is not installed! Please install and download a Model",
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 30, 0, 0),
                TextWrapping = TextWrapping.WrapWholeWords
            };

            // Create the HyperlinkButton
            HyperlinkButton ollamaLink = new()
            {
                NavigateUri = (new Uri("https://ollama.com")),
                Content = "Get Ollama",
                HorizontalAlignment = HorizontalAlignment.Center
            };

            // Create the closeButton
            Button closeButton = new()
            {
                Content = "OK",
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, -100, 0, 0)
            };
            closeButton.Click += (Object _, RoutedEventArgs __) =>
            {
                newWindow.Close();
                Application.Current.Exit();
            };

            // Add the messageText to the Grid at row 0
            grid.Children.Add(messageText);
            Grid.SetRow(messageText, 0);

            // Add the ollamaLink to the Grid at row 1
            grid.Children.Add(ollamaLink);
            Grid.SetRow(ollamaLink, 1);

            // The empty space (row 2) will automatically stretch due to the star sizing

            // Add the closeButton to the Grid at row 3 (bottom row)
            grid.Children.Add(closeButton);
            Grid.SetRow(closeButton, 3);

            // Add a background to the Grid
            ResourceDictionary resources = Application.Current.Resources;
            resources.TryGetValue("AcrylicBackgroundFillColorBaseBrush", out object brush);
            grid.Background = brush.As<Brush>();

            // Set the Grid as the content of the window
            newWindow.Content = grid;
            newWindow.Title = "Error";
            newWindow.Closed += (
                (Object _, WindowEventArgs __) =>
                {
                    newWindow.Close();
                    Application.Current.Exit();
                }
            );

            // Extend content into the title bar and configure the window's presenter
            newWindow.ExtendsContentIntoTitleBar = true;

            var appWindow = newWindow.AppWindow;
            var presenter = appWindow.Presenter.As<OverlappedPresenter>();

            presenter.IsMaximizable = (false);
            presenter.IsMinimizable = (false);
            presenter.IsAlwaysOnTop = (true);

            // Activate the new window
            newWindow.Activate();
        }

        public void ShowModelDialog()
        {
            var newWindow = new Window();
            newWindow.AppWindow.Resize(new Windows.Graphics.SizeInt32(500, 300));

            // Create a Grid container
            Grid grid = new();

            // Define rows for the Grid
            RowDefinition rowDef1 = new()
            {
                Height = new GridLength(1, GridUnitType.Star) // Auto-size row for messageText
            };
            grid.RowDefinitions.Add(rowDef1);

            RowDefinition rowDef2 = new()
            {
                Height = new GridLength(1, GridUnitType.Auto) // Auto-size row for ollamaLink
            };
            grid.RowDefinitions.Add(rowDef2);

            RowDefinition rowDef3 = new()
            {
                Height = new GridLength(1, GridUnitType.Star) // Take remaining space for layout flexibility
            };
            grid.RowDefinitions.Add(rowDef3);

            RowDefinition rowDef4 = new()
            {
                Height = new GridLength(1, GridUnitType.Auto) // Auto-size row for closeButton
            };
            grid.RowDefinitions.Add(rowDef4);

            // Create the messageText block
            TextBlock messageText = new()
            {
                Text = "No Ollama Model downloaded! Please download a Model",
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 30, 0, 0),
                TextWrapping = TextWrapping.WrapWholeWords
            };

            // Create the HyperlinkButton
            HyperlinkButton ollamaLink = new()
            {
                NavigateUri = (new Uri("https://ollama.com/library")),
                Content = "Get Models",
                HorizontalAlignment = HorizontalAlignment.Center
            };

            // Create the closeButton
            Button closeButton = new()
            {
                Content = "OK",
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, -100, 0, 0)
            };
            closeButton.Click += (Object _, RoutedEventArgs __) =>
            {
                newWindow.Close();
                Application.Current.Exit();
            };

            // Add the messageText to the Grid at row 0
            grid.Children.Add(messageText);
            Grid.SetRow(messageText, 0);

            // Add the ollamaLink to the Grid at row 1
            grid.Children.Add(ollamaLink);
            Grid.SetRow(ollamaLink, 1);

            // The empty space (row 2) will automatically stretch due to the star sizing

            // Add the closeButton to the Grid at row 3 (bottom row)
            grid.Children.Add(closeButton);
            Grid.SetRow(closeButton, 3);

            // Add a background to the Grid
            ResourceDictionary resources = Application.Current.Resources;
            resources.TryGetValue("AcrylicBackgroundFillColorBaseBrush", out object brush);
            grid.Background = brush.As<Brush>();

            // Set the Grid as the content of the window
            newWindow.Content = grid;
            newWindow.Title = "Error";
            newWindow.Closed += (
                (Object _, WindowEventArgs __) =>
                {
                    newWindow.Close();
                    Application.Current.Exit();
                }
            );

            // Extend content into the title bar and configure the window's presenter
            newWindow.ExtendsContentIntoTitleBar = true;

            var appWindow = newWindow.AppWindow;
            var presenter = appWindow.Presenter.As<OverlappedPresenter>();

            presenter.IsMaximizable = (false);
            presenter.IsMinimizable = (false);
            presenter.IsAlwaysOnTop = (true);

            // Activate the new window
            newWindow.Activate();
        }

    }
}
