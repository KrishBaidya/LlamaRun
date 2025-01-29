#include "pch.h"
#include "CloudLLMService.h"

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Web::Http;
using namespace Windows::Data::Json;
using namespace Windows::Storage::Streams;

IAsyncAction CloudLLMService::TextGeneration(std::string model, std::string inputText)
{
	try {
		HttpClient httpClient;
		Uri uri(L"http://localhost:3000/generate/stream");

		JsonObject requestBody;
		requestBody.Insert(L"prompt", JsonValue::CreateStringValue(to_hstring(inputText)));

		HttpStringContent content(
			requestBody.ToString(),
			UnicodeEncoding::Utf8,
			L"application/json"
		);

		// Send the HTTP POST request
		HttpResponseMessage response = co_await httpClient.PostAsync(uri, content);

		if (!response.IsSuccessStatusCode()) {
			auto code = reinterpret_cast<int32_t*>(response.StatusCode());
			mainWindow->TextBoxElement().Text(L"HTTP Error: " + to_hstring(*code));
			co_return;
		}

		// Get the input stream
		IInputStream inputStream = co_await response.Content().ReadAsInputStreamAsync();
		DataReader reader(inputStream);

		std::wstring buffer;

		while (true) {
			// Read the next chunk of data
			uint32_t bytesRead = co_await reader.LoadAsync(4096);
			if (bytesRead == 0) break;

			// Append the new data to the buffer
			winrt::hstring data = reader.ReadString(bytesRead);
			buffer += data.c_str();

			// Process all complete SSE events (ending with \n\n)
			size_t pos = 0;
			while ((pos = buffer.find(L"\n\n", pos)) != std::wstring::npos) {
				std::wstring event = buffer.substr(0, pos);
				buffer.erase(0, pos + 2); // Remove processed event

				// Parse SSE event
				if (event._Starts_with(L"data: ")) {
					std::wstring jsonStr = event.substr(6); // Skip "data: "

					try {
						JsonObject jsonResponse = JsonObject::Parse(jsonStr);

						if (jsonResponse.HasKey(L"response")) {
							hstring responsePart = jsonResponse.GetNamedString(L"response");
							mainWindow->UpdateTextBox(responsePart);
						}

						if (jsonResponse.HasKey(L"done") &&
							jsonResponse.GetNamedBoolean(L"done")) {
							// Stream completed
							mainWindow->TextBoxElement().IsReadOnly(false);
							mainWindow->StopSkeletonLoadingAnimation();
							co_return;
						}
					}
					catch (const hresult_error& ex) {
						OutputDebugString(ex.message().c_str());
					}
				}
				pos = 0; // Reset position for next search
			}
		}
	}
	catch (const hresult_error& ex) {
		mainWindow->TextBoxElement().Text(L"Error: " + ex.message());
	}

	// Final cleanup
	mainWindow->TextBoxElement().IsReadOnly(false);
	mainWindow->StopSkeletonLoadingAnimation();
}

//Currenlty just return true!!
IAsyncOperation<bool> CloudLLMService::LoadModels()
{
	co_return true;
}

std::vector<std::string> CloudLLMService::GetModels()
{
	return models;
}
