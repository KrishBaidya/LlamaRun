using ModelContextProtocol.Client;
using OllamaSharp;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;

namespace LlamaRun
{
    internal class OllamaService
    {
        private static readonly OllamaApiClient _client = new(new Uri("http://127.0.0.1:11434"));

        public static async Task<bool> IsOllamaRunning()
        {
            try
            {
                return await _client.IsRunningAsync();
            }
            catch
            {
                return false;
            }
        }

        public static async Task<List<Model>> GetAvailableModels()
        {
            if (!await IsOllamaRunning()) return [];

            try
            {
                var localModels = await _client.ListLocalModelsAsync();

                // Convert OllamaSharp models to MCP 'Model' objects
                return localModels.Select(m => new Model(m.Name, [Capabilities.Text])).ToList();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Ollama List Error: {ex.Message}");
                return [];
            }
        }

        public static async Task TextGeneration(string modelName, string inputText, IList<McpClientTool>? tools)
        {
            if (!await IsOllamaRunning())
            {
                AIServiceManager.GetInstance().MainWindow?.DispatcherQueue.TryEnqueue(() =>
                {
                    ShowOllamaUnavaliableWindow.GetInstance().ShowOllamaDialog();
                });
                return;
            }

            try
            {
                var request = new OllamaSharp.Models.GenerateRequest
                {
                    Model = modelName,
                    Prompt = inputText
                };
                await foreach (var stream in _client.GenerateAsync(request))
                {
                    if (stream == null || stream.Done)
                    {
                        return;
                    }
                    AIServiceManager.GetInstance().MainWindow?.DispatcherQueue.TryEnqueue(() =>
                    {
                        AIServiceManager.GetInstance().MainWindow?.UpdateTextBox(stream.Response);
                    });
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Ollama Generation Error: {ex.Message}");
            }
        }
    }
}