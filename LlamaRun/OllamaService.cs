using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Windows.Foundation;
using OllamaSharp;
using System.Diagnostics;
using System.Collections.Immutable;

namespace LlamaRun
{
    internal class OllamaService : IAIService
    {
        private readonly OllamaApiClient _ollamaClient = new(new Uri("http://127.0.0.1:11434"));
        private List<string> _models = [];

        public async override Task TextGeneration(string model, string inputText)
        {
            try
            {
                if (!await IsOllamaAvailable())
                {
                    ShowOllamaUnavaliableWindow.GetInstance().ShowOllamaDialog();
                    return; // Important: Stop execution if Ollama isn't available
                }

                if (!await CheckOllamaRunning())
                {
                    ShowOllamaUnavaliableWindow.GetInstance().ShowOllamaDialog();
                    return;
                }
                await foreach (var response in _ollamaClient.GenerateAsync(new OllamaSharp.Models.GenerateRequest { Model = model, Prompt = inputText }))
                {
                    if (AIServiceManager.GetInstance().MainWindow == null)
                    {
                        Debug.WriteLine("MainWindow is null");
                        return;
                    }

                    if (response!.Done)
                    {
                        AIServiceManager.GetInstance().MainWindow!.DispatcherQueue.TryEnqueue(() =>
                        {
                            AIServiceManager.GetInstance().MainWindow!.StopSkeletonLoadingAnimation();
                            AIServiceManager.GetInstance().MainWindow!.TextBoxElement.IsReadOnly = false;
                        });
                    }
                    else
                    {
                        AIServiceManager.GetInstance().MainWindow!.DispatcherQueue.TryEnqueue(() =>
                        {
                            AIServiceManager.GetInstance().MainWindow!.UpdateTextBox(response.Response);
                        });
                    }
                }


            }
            catch (Exception ex)
            {
                // Handle exceptions from OllamaSharp
                Debug.WriteLine($"OllamaSharp exception: {ex}");
                // Consider showing an error message to the user using a ContentDialog (on the UI thread)
            }
        }

        public override async Task<bool> LoadModels()
        {
            if (!await IsOllamaAvailable())
            {
                //ShowOllamaUnavaliableWindow.GetInstance().ShowOllamaDialog();
                //AIServiceManager.GetInstance().mainWindow!.Close();  // Ensure this is a C# method.
                return false;
            }

            if (!await CheckOllamaRunning())
            {
                //ShowOllamaUnavaliableWindow.GetInstance().ShowModelDialog(); // Need to handle when Ollama is installed but not running.
                //AIServiceManager.GetInstance().mainWindow!.Close();  // Ensure this is a C# method.
                return false;
            }

            return await CheckandLoadOllama();
        }

        private async Task<bool> CheckandLoadOllama()
        {
            try
            {
                // Once server is up, load the models
                _models = (await _ollamaClient.ListLocalModelsAsync()).Select(m => m.Name).ToList();

                if (_models.Count == 0)
                {
                    ShowOllamaUnavaliableWindow.GetInstance().ShowModelDialog();
                    AIServiceManager.GetInstance().MainWindow!.Close();
                    return false;
                }

                DataStore.GetInstance().SetModels(_models);

                string selectedModel = SettingsWindow.LoadSetting("SelectedModel");
                if (!string.IsNullOrEmpty(selectedModel))
                {
                    DataStore.GetInstance().SetSelectedModel(selectedModel);
                }

                if (!string.IsNullOrEmpty(DataStore.GetInstance().GetSelectedModel()))
                {

                }
                else
                {
                    DataStore.GetInstance().SetSelectedModel(_models[0]);
                    SettingsWindow.SaveSetting("SelectedModel", _models[0]); // Save setting through C#
                }

                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Exception in CheckandLoadOllama: {ex}");
                return false;
            }
        }

        public async Task<bool> IsOllamaAvailable()
        {
            try
            {
                // Use Process.Start to check if Ollama is available
                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "ollama",
                        Arguments = "--version",
                        RedirectStandardOutput = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    }
                };
                process.Start();
                await process.WaitForExitAsync();
                return process.ExitCode == 0;
            }
            catch
            {
                return false; // Ollama command failed (likely not installed)
            }
        }

        public async Task<bool> CheckOllamaRunning()
        {
            try
            {
                return await _ollamaClient.IsRunningAsync();
            }
            catch
            {
                return false;
            }
        }

        public override Span<string> GetModels()
        {
            return _models.ToArray().AsSpan();
        }

        public override string GetServiceName()
        {
            return "Ollama";
        }

        public override void SetAPIKey(string apiKey)
        {
            return;
        }
    }
}
