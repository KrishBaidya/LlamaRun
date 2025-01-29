#pragma once

#include "pch.h"
#include "OllamaService.h"

#include <ShowOllamaUnavaliableWindow.h>
#include <DataStore.cpp>
#include <PluginManager.h>
#include <BackgroundOllama.hpp>

IAsyncAction OllamaService::TextGeneration(std::string model, std::string inputText) {
	ollama::generate(model, inputText, this->OllamaTextGeneration());

	co_return;
}

IAsyncOperation<bool> OllamaService::LoadModels()
{
	if (IsOllamaAvailable())
	{
		OutputDebugString(L"Ollama Avaliable");
	}
	else
	{
		ShowOllamaUnavaliableWindow::GetInstance().showOllamaDialog();
		mainWindow->MainWindow::Close();
	}

	while (!ollama::is_running()) {
		std::this_thread::sleep_for(std::chrono::seconds(1));
	}

	co_await this->CheckandLoadOllama();

	co_return true;
}

IAsyncOperation<bool> OllamaService::CheckandLoadOllama()
{
	try
	{
		// Once server is up, load the models
		models = ListModel();

		if (models.size() <= 0) {
			ShowOllamaUnavaliableWindow::GetInstance().showModelDialog();
			mainWindow->MainWindow::Close();
		}

		winrt::Windows::Foundation::Collections::IVector<hstring> VectorModels = winrt::single_threaded_vector<hstring>();

		for (const auto& item : models)
		{
			VectorModels.Append(to_hstring(item));
		}

		DataStore::GetInstance().SetModels(VectorModels);

		if (winrt::LlamaRun::implementation::SettingsWindow::LoadSetting("SelectedModel") != L"")
		{
			auto selectedModel = winrt::LlamaRun::implementation::SettingsWindow::LoadSetting("SelectedModel");
			DataStore::GetInstance().SetSelectedModel(to_string(selectedModel));
		}

		if (DataStore::GetInstance().GetSelectedModel() != "")
		{
			LoadModelIntoMemory(DataStore::GetInstance().GetSelectedModel());
		}
		else
		{
			DataStore::GetInstance().SetSelectedModel(models[0]);
			LoadModelIntoMemory(models[0]);

			DataStore::GetInstance().SaveSelectedModel();
		}
		co_return true;
	}
	catch (const std::exception& ex)
	{
		std::cout << ex.what() << std::endl;
		co_return false;
	}
}

bool OllamaService::IsOllamaAvailable()
{
	// Try running the Ollama command using system()
	int result = system("ollama --version");

	// Check the result, if the command fails, Ollama is not installed
	return result == 0;
}

std::function<void(const ollama::response&)> OllamaService::OllamaTextGeneration() {
	if (mainWindow == nullptr)
	{
		std::cout << "Failed to Generate Restart the App" << std::endl;
	}
	auto& weakThis = *mainWindow;

	using ResponseCallback = winrt::delegate<void(ollama::response const&)>;
	ResponseCallback callback_textbox = [&weakThis](ollama::response const& response) {
		if (weakThis && weakThis.DispatcherQueue()) { // Check for both 'this' and DispatcherQueue
			weakThis.DispatcherQueue().TryEnqueue(
				winrt::Microsoft::UI::Dispatching::DispatcherQueuePriority::Normal,
				[&weakThis, response]() {
					if (response.as_json()["done"] == true) {
						PluginManager::GetInstance().BroadcastEvent("afterTextGeneration");

						weakThis.StopSkeletonLoadingAnimation();
						weakThis.TextBoxElement().IsReadOnly(false);
					}
					weakThis.UpdateTextBox(to_hstring(response.as_simple_string()));
				}
			);
		}
		else {
			// Handle case where 'this' or DispatcherQueue is null
			// (e.g., log a message, display an error)
		}
		};

	return callback_textbox;
}

std::vector<std::string> OllamaService::GetModels() {
	return models;
}