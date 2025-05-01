using CommunityToolkit.WinUI;
using Microsoft.UI.Dispatching;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.Serialization;
using System.Text;
using System.Threading.Tasks;

namespace LlamaRun
{
	internal class CloudLLMService
	{
		[DataContract]
		internal class PromptModel
		{
			[DataMember(IsRequired = true)]
			public string? prompt { get; set; }

			[DataMember(IsRequired = true)]
			public string? model { get; set; }
		}

		private static readonly HttpClient _httpClient = new();
#if DEBUG
		private const string BackendUrl = "http://localhost:3000";
#else
		private const string BackendUrl = "https://llamarun.vercel.app";
#endif

		public static Dictionary<string, string> GetModels()
		{
			Dictionary<string, string> models = [];
			_ = Models.models.Values.All((providers) => { models = models.Union(providers.Models).ToDictionary(); return true; });
			return models;
		}

		public static async Task TextGeneration(string model, string inputText)
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

			HttpResponseMessage response = _httpClient.Send(request, HttpCompletionOption.ResponseHeadersRead);
			response.EnsureSuccessStatusCode();

			await AIServiceManager.GetInstance().MainWindow!.DispatcherQueue.EnqueueAsync(async () =>
			{
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
								break; // Exit the loop when done
							}

							// Deserialize the JSON object fully 
							string textChunk = parsedData["text"]?.ToString() ?? "";

							AIServiceManager.GetInstance().MainWindow!.UpdateTextBox(textChunk);
						}
						catch (Exception ex)
						{
							Debug.WriteLine($"Error parsing JSON: {ex.Message}");
							// Optionally handle parsing errors
						}
					}
				}
			},
			Microsoft.UI.Dispatching.DispatcherQueuePriority.High);
		}
	}
}