using Microsoft.UI.Dispatching;
using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Services.Maps;

namespace LlamaRun
{
    internal class AIServiceManager
    {
        IAIService? activeService;

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

        public void SetActiveService(IAIService service)
        {
            activeService = service;
        }

        public void SetActiveServiceByName(string service)
        {
            if (service == "Ollama")
            {
                AIServiceManager.GetInstance().SetActiveService(new OllamaService());
            }
            else if (service == "Google Gemini")
            {
                AIServiceManager.GetInstance().SetActiveService(new CloudLLMService());
            }

            DataStore.GetInstance().SetModelService(service);
        }

        public IAIService GetActiveService()
        {
            return activeService!;
        }

        async Task<bool> CheckandLoad()
        {
            if (activeService != null)
            {
                try
                {
                    if (activeService.IsApiKeySet())
                    {
                        bool modelLoaded = await activeService.LoadModels();

                        var models = activeService.GetModels().ToArray();
                        List<string> VectorModels = [];

                        foreach (var item in models)
                        {
                            VectorModels.Add(item);
                        }

                        DataStore.GetInstance().SetModels(VectorModels);

                        Debug.WriteLine("Model loaded: " + modelLoaded);
                        return modelLoaded; // Return the actual result of LoadModels
                    }
                    else
                    {
                        return false;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("Exception in CheckandLoadAsync: " + ex.Message);
                    return false; // Return false on error
                }
            }
            else
            {
                Debug.WriteLine("No AI service selected!");
                return false;
            }
        }

        public async Task LoadModels()
        {
            if (MainWindow != null)
            {
                if (MainWindow.DispatcherQueue == null)
                {
                    Debug.WriteLine("Error: DispatcherQueue is null.");
                    return;
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
                    if (GetActiveService().GetServiceName() == "Ollama")
                    {
                        bool loaded = false;
                        while (!loaded)
                        {
                            loaded = await CheckandLoad(); // Now CheckandLoad runs in the background
                            await Task.Delay(5000); //Sleep 5 Sec Before checking Again
                        }

                    }

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
                    return;
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

            DataStore.GetInstance().SetModels(AIServiceManager.GetInstance().GetModels().ToImmutableArray());

            return;
        }

        public Span<String> GetModels()
        {
            return GetActiveService().GetModels();
        }

        public async Task<bool> TextGeneration(string model, string inputText)
        {
            if (activeService == null || activeService?.GetType() == typeof(OllamaService))
            {
                await activeService!.TextGeneration(model, inputText);
            }
            else if (activeService != null && activeService.GetType() == typeof(CloudLLMService))
            {
                await activeService.TextGeneration(model, inputText);
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
