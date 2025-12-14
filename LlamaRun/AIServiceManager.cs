using Microsoft.UI.Dispatching;
using ModelContextProtocol.Client;
using OllamaSharp.Models;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;

namespace LlamaRun
{
    internal class AIServiceManager
    {
        public MainWindow? MainWindow { get; private set; } = null;

        private static AIServiceManager? instance = null;
        public static AIServiceManager GetInstance()
        {
            instance ??= new AIServiceManager();
            return instance;
        }

        public void SetMainWindowPtr(MainWindow mainWindowPtr)
        {
            this.MainWindow = mainWindowPtr;
        }

        public Task LoadModels()
        {
            DataStore.GetInstance().SetModels(CloudLLMService.GetModels());

            if (MainWindow != null)
            {
                if (MainWindow.DispatcherQueue == null)
                {
                    Debug.WriteLine("Error: DispatcherQueue is null.");
                    return Task.CompletedTask;
                }

                // Update UI to indicate loading (on UI thread)
                MainWindow.DispatcherQueue!.TryEnqueue(() =>
                {
                    MainWindow.TextBoxElement.PlaceholderText = "Waiting for your AI buddy to connect!";
                    MainWindow.TextBoxElement.IsReadOnly = true;
                    MainWindow.StopSkeletonLoadingAnimation();
                });

                try
                {
                    DispatcherQueueHandler action = () =>
                    {
                        MainWindow.TextBoxElement.PlaceholderText = "Ask Anything!";
                        MainWindow.TextBoxElement.IsReadOnly = false;
                        MainWindow.StopSkeletonLoadingAnimation();
                    };

                    var asyncAction = MainWindow.DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Normal, action);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("Error during CheckandLoad: " + ex.Message);
                    MainWindow.DispatcherQueue.TryEnqueue(() =>
                    {
                        MainWindow.TextBoxElement.Text = null;
                        MainWindow.TextBoxElement.PlaceholderText = ("Error: " + ex.Message);
                        MainWindow.TextBoxElement.IsReadOnly = false;
                        MainWindow.StopSkeletonLoadingAnimation();
                    });
                    return Task.CompletedTask;
                }


                // Update UI after loading (on UI thread)
                MainWindow.DispatcherQueue.TryEnqueue(() =>
                {
                    MainWindow.TextBoxElement.PlaceholderText = "Ask Anything!";
                    MainWindow.TextBoxElement.IsReadOnly = false;
                    MainWindow.StopSkeletonLoadingAnimation();
                });
            }

            else
            {
                Debug.WriteLine("Error: Could not get strong reference to MainWindow.");
            }

            DataStore.GetInstance().SetModels(CloudLLMService.GetModels());

            return Task.CompletedTask;
        }

        public static bool IsModelCloudBased(string model)
        {
            foreach (var item in Models.models)
            {
                foreach (var item1 in item.Value.Models)
                {
                    if (item1.Value.Name.Equals(model))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        public async Task<bool> TextGeneration(Model model, string inputText, IList<McpClientTool>? tools)
        {
            bool isCloud = IsModelCloudBased(model.Name);

            // 2. Route
            Debug.WriteLine($"Generating with: {model.Name} (Cloud: {isCloud})");

            if (isCloud)
            {
                await CloudLLMService.TextGeneration(model, inputText, tools);
            }
            else
            {
                // Default to Ollama for everything else (llama3, mistral, custom-model, etc.)
                await OllamaService.TextGeneration(model.Name, inputText, tools);
            }

            MainWindow!.DispatcherQueue.TryEnqueue(() =>
            {
                MainWindow.TextBoxElement.PlaceholderText = "Ask Anything!";
                MainWindow.TextBoxElement.IsReadOnly = false;
                MainWindow.StopSkeletonLoadingAnimation();
            });

            return true;
        }
    }
}
