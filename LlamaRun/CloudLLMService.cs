using ModelContextProtocol.Client;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace LlamaRun
{
    // JsonContext for System.Text.Json serialization
    [JsonSerializable(typeof(PromptModel))]
    [JsonSerializable(typeof(MCPToolSchema))]
    [JsonSerializable(typeof(List<MCPToolSchema>))]
    [JsonSerializable(typeof(List<KeyValuePair<string, object?>>))]
    [JsonSerializable(typeof(Dictionary<string, object>))]
    [JsonSourceGenerationOptions(
        WriteIndented = false, // Changed to false for smaller payload
        PropertyNamingPolicy = JsonKnownNamingPolicy.Unspecified, // Changed from CamelCase
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        ReferenceHandler = JsonKnownReferenceHandler.IgnoreCycles
    )]
    public partial class CloudLLMJsonContext : JsonSerializerContext
    {
    }

    public class MCPToolSchema
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("parameters")]
        public object? Parameters { get; set; }
    }

    public class PromptModel
    {
        [JsonPropertyName("prompt")]
        public string? Prompt { get; set; }

        [JsonPropertyName("model")]
        public string? Model { get; set; }

        [JsonPropertyName("Tools")]
        public List<MCPToolSchema>? Tools { get; set; }
    }


    internal class CloudLLMService
    {
        private static readonly HttpClient _httpClient = new();

        public static Dictionary<string, Model> GetModels()
        {
            Dictionary<string, Model> models = [];
            _ = Models.models.Values.All((providers) => { models = models.Union(providers.Models).ToDictionary(); return true; });
            return models;
        }

        public static async Task TextGeneration(Model model, string inputText, IList<McpClientTool>? tools)
        {
            try
            {
                string? jwtToken = DataStore.GetInstance().LoadJWT().GetJWT();
                if (string.IsNullOrEmpty(jwtToken))
                {
                    throw new InvalidOperationException("Not Authenticated. Try Signing In Again!!");
                }

                _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwtToken);

                // Create prompt model
                PromptModel myPrompt = new()
                {
                    Prompt = inputText,
                    Model = model.Name
                };

                // Force reads (if still needed for compiler optimization)
                string tempPrompt = myPrompt.Prompt!;
                string tempModel = myPrompt.Model!;

                List<MCPToolSchema> tempTool = [];
                if (tools != null)
                {
                    foreach (var item in tools)
                    {
                        // Parse the JsonSchema safely
                        object? parameters = null;
                        try
                        {
                            var jsonString = item.JsonSchema.GetRawText();
                            parameters = JsonSerializer.Deserialize<object>(jsonString);
                        }
                        catch (JsonException ex)
                        {
                            Debug.WriteLine($"Error parsing tool schema: {ex.Message}");
                            parameters = null;
                        }

                        var toolSchema = new MCPToolSchema
                        {
                            Name = item.Name,
                            Description = item.Description,
                            Parameters = parameters,
                        };

                        tempTool.Add(toolSchema);
                    }
                }

                myPrompt.Tools = tempTool.Count > 0 ? tempTool : null;

                // Serialize using System.Text.Json with JsonContext
                var json = JsonSerializer.Serialize(myPrompt);

                // Debug output to see what's being sent
                Debug.WriteLine($"Request JSON: {json}");
                Debug.WriteLine($"Request URL: {Constants.BaseServerUrl}/api/llm/generate");

                var request = new HttpRequestMessage(HttpMethod.Post, $"{Constants.BaseServerUrl}/api/llm/generate")
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                request.Headers.TransferEncodingChunked = true;

                try
                {
                    HttpResponseMessage response = _httpClient.Send(request, HttpCompletionOption.ResponseHeadersRead);

                    // Debug response status before throwing exception
                    Debug.WriteLine($"Response Status: {response.StatusCode}");
                    Debug.WriteLine($"Response Headers: {response.Headers}");

                    if (!response.IsSuccessStatusCode)
                    {
                        var errorContent = await response.Content.ReadAsStringAsync();
                        Debug.WriteLine($"Error Response: {errorContent}");
                        throw new HttpRequestException($"Request failed with status {response.StatusCode}: {errorContent}");
                    }

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
                                JObject parsedData = serializer.Deserialize<JObject>(jsonReader)!;
                                if (parsedData.ContainsKey("done") && parsedData["done"]!.Value<string>() == "true")
                                {
                                    break;
                                }

                                // Parse Again
                                if (parsedData["text"] is JObject textObject)
                                {
                                    JObject? parsedResponse = textObject;

                                    // Tool Calls
                                    if (parsedResponse["type"]?.Value<string>() == "tool-call" &&
                                        parsedResponse!.ContainsKey("toolName") &&
                                        tools != null)
                                    {
                                        foreach (var item in tools)
                                        {
                                            if (item.Name == parsedResponse["toolName"]!.Value<string>())
                                            {
                                                Debug.WriteLine(parsedResponse["toolName"]);

                                                if (parsedResponse.TryGetValue("args", out var argsToken) && argsToken is JObject argsObj)
                                                {
                                                    var args = argsObj.ToObject<Dictionary<string, object>>();
                                                    if (args != null)
                                                    {
                                                        var callToolResponse = await item.CallAsync(args!);

                                                        if (callToolResponse != null)
                                                        {
                                                            // Create a simplified response object to avoid circular references
                                                            var simplifiedResponse = CreateSimplifiedResponse(callToolResponse);

                                                            var conversationHistory = new List<KeyValuePair<string, object?>>
                                                            {
                                                                new("user", inputText),
                                                                new("assistant", parsedResponse.ToString()),
                                                                new("user", simplifiedResponse)
                                                            };

                                                            // Use System.Text.Json with JsonContext for serialization
                                                            var newInput = JsonSerializer.Serialize(
                                                                conversationHistory
                                                            );

                                                            await TextGeneration(model, newInput, tools);
                                                        }
                                                    }
                                                    else
                                                    {
                                                        await item.CallAsync();
                                                    }
                                                }
                                                else
                                                {
                                                    await item.CallAsync();
                                                }
                                            }
                                        }
                                    }
                                    // Text 
                                    if (parsedResponse["type"]?.Value<string>() == "text-delta" &&
                                        parsedResponse!.ContainsKey("textDelta"))
                                    {
                                        AIServiceManager.GetInstance().MainWindow!.UpdateTextBox(
                                            (string?)parsedResponse["textDelta"] ?? String.Empty);
                                    }
                                }
                            }
                            catch (Exception ex)
                            {
                                Debug.WriteLine($"Error parsing JSON: {ex.Message}");
                            }
                        }
                    }
                }
                catch (HttpRequestException httpEx)
                {
                    Debug.WriteLine($"HTTP Request Exception: {httpEx.Message}");
                    Debug.WriteLine($"Stack Trace: {httpEx.StackTrace}");
                    throw; // Re-throw to maintain original behavior
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"General Exception in TextGeneration: {ex.Message}");
                Debug.WriteLine($"Stack Trace: {ex.StackTrace}");
                throw; // Re-throw to maintain original behavior
            }
        }

        // Helper method to create a simplified response object without circular references
        private static object CreateSimplifiedResponse(object callToolResponse)
        {
            try
            {
                // Create a simple object with only the necessary data
                var simplified = new Dictionary<string, object>();

                // Use reflection safely to extract Content property
                var responseType = callToolResponse.GetType();
                var contentProperty = responseType.GetProperty("Content");

                if (contentProperty != null)
                {
                    var contentValue = contentProperty.GetValue(callToolResponse);
                    if (contentValue != null)
                    {
                        var contentList = new List<object>();

                        // Check if Content is enumerable
                        if (contentValue is System.Collections.IEnumerable enumerable)
                        {
                            foreach (var content in enumerable)
                            {
                                if (content != null)
                                {
                                    var contentItem = new Dictionary<string, object?>();
                                    var contentType = content.GetType();

                                    // Safely extract Text property
                                    var textProperty = contentType.GetProperty("Text");
                                    if (textProperty != null)
                                    {
                                        var textValue = textProperty.GetValue(content);
                                        if (textValue != null)
                                            contentItem["text"] = textValue.ToString();
                                    }

                                    // Safely extract Data property
                                    var dataProperty = contentType.GetProperty("Data");
                                    if (dataProperty != null)
                                    {
                                        var dataValue = dataProperty.GetValue(content);
                                        if (dataValue != null)
                                            contentItem["data"] = dataValue.ToString();
                                    }

                                    if (contentItem.Count > 0)
                                        contentList.Add(contentItem);
                                }
                            }
                        }

                        if (contentList.Count > 0)
                            simplified["content"] = contentList;
                    }
                }

                // Add other simple properties as needed
                // You can add more properties here using the same reflection pattern

                return simplified.Count > 0 ? simplified : new { message = "Tool response processed" };
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error creating simplified response: {ex.Message}");
                // Return a minimal safe object
                return new { error = "Failed to process tool response", message = ex.Message };
            }
        }
    }
}