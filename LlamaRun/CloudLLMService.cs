// CloudLLMService.cs
using Microsoft.UI.Dispatching;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using OllamaSharp.Models;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Runtime.Serialization;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Windows.Foundation;

namespace LlamaRun
{
    internal class CloudLLMService : IAIService
    {
        [DataContract]
        internal class PromptModel // Better name
        {
            [DataMember(IsRequired = true)]
            public string? prompt { get; set; }

            [DataMember(IsRequired = true)]
            public string? model { get; set; }
        }

        private readonly HttpClient _httpClient = new();
#if DEBUG
        private const string BackendUrl = "http://localhost:3000"; // Your Next.js Backend URL
#else
        private const string BackendUrl = "https://llamarun.vercel.app"; // Your Next.js Backend URL
#endif

        private string? _apiKey; // To store API Key if needed
        internal static new readonly string[] models = ["gemini-2.0-flash"];

        public override string GetServiceName()
        {
            return "Google Gemini";
        }

        public override void SetAPIKey(string apiKey)
        {
            _apiKey = apiKey; // Store API Key if needed
        }

        public override bool IsApiKeySet()
        {
            return !string.IsNullOrEmpty(_apiKey); // Check if API Key is set
        }

        public override Span<string> GetModels()
        {
            // Gemini API model listing might be different, return placeholder or actual logic if applicable
            return models.AsSpan(); // Example model
        }

        public override async Task<bool> LoadModels()
        {
            // Model loading might not be directly applicable to Cloud LLMs, return true or actual logic if needed
            return true; // Assume models are available in the cloud
        }

        public override async Task TextGeneration(string model, string inputText)
        {
            string? jwtToken = DataStore.GetInstance().LoadJWT().GetJWT();
            if (string.IsNullOrEmpty(jwtToken))
            {
                throw new InvalidOperationException("Not Authenticated. Try Signing In Again!!");
            }

            _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwtToken);

            //Need to Force Read Because Compiler is making Optimization and code is breaking!
            PromptModel myPrompt = new() { prompt = inputText, model = model };
            string tempPrompt = myPrompt.prompt;  // Force a read
            string tempModel = myPrompt.model;    // Force a read
            var json = JsonConvert.SerializeObject(myPrompt);

            var request = new HttpRequestMessage(HttpMethod.Post, $"{BackendUrl}/api/llm/generate")
            {
                Content = new StringContent(json.ToString(), Encoding.UTF8, "application/json")
            };
            request.Headers.TransferEncodingChunked = true; // Enable chunked transfer (important for streaming)

            // Use SendAsync with HttpCompletionOption.ResponseHeadersRead
            HttpResponseMessage response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();

            using var stream = await response.Content.ReadAsStreamAsync();
            using var streamReader = new StreamReader(stream);
            using var jsonReader = new Newtonsoft.Json.JsonTextReader(streamReader)
            {
                SupportMultipleContent = true
            };

            var serializer = new Newtonsoft.Json.JsonSerializer();
            while (await jsonReader.ReadAsync())
            {
                if (jsonReader.TokenType == Newtonsoft.Json.JsonToken.StartObject)
                {
                    try
                    {
                        // Deserialize the JSON object fully 
                        JObject parsedData = serializer.Deserialize<JObject>(jsonReader)!;
                        if (parsedData.ContainsKey("done") && parsedData["done"]!.Value<string>() == "true")
                        {
                            break; // Exit the loop when done
                        }
                        string textChunk = parsedData["text"]?.ToString() ?? "";

                        // Callback on the UI thread
                        AIServiceManager.GetInstance().MainWindow!.DispatcherQueue.TryEnqueue(() =>
                        {
                            AIServiceManager.GetInstance().MainWindow!.UpdateTextBox(textChunk);
                        });
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"Error parsing JSON: {ex.Message}");
                        // Optionally handle parsing errors
                    }
                }
            }
        }
    }
}