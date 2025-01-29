#pragma once
#include "pch.h"
#include "AIServiceManager.h"

#include <DataStore.cpp>
#include "CloudLLMService.h"
#include <OllamaService.h>

#include <winrt/Windows.Foundation.h>

AIServiceManager& AIServiceManager::GetInstance()
{
	static AIServiceManager instance;
	return instance;
}

void AIServiceManager::SetActiveService(std::unique_ptr<AIService> service)
{
	activeService = std::move(service);
}

void AIServiceManager::SetActiveServiceByName(std::string const& service)
{
	if (service == "Ollama")
	{
		AIServiceManager::GetInstance().SetActiveService(std::make_unique<OllamaService>());
	}
	else if (service == "Google Gemini")
	{
		AIServiceManager::GetInstance().SetActiveService(std::make_unique<CloudLLMService>());
	}
}

AIService* AIServiceManager::GetActiveService() const&
{
	return activeService.get();
}

IAsyncOperation<bool> AIServiceManager::CheckandLoad()
{
	if (activeService)
	{
		// Check if activeService is valid *before* dereferencing
		if (activeService != nullptr) { // Redundant but good practice
			try {
				if (activeService->isApiKeySet())
				{
					bool modelLoaded = co_await activeService->LoadModels();

					auto models = activeService->GetModels();
					winrt::Windows::Foundation::Collections::IVector<hstring> VectorModels = winrt::single_threaded_vector<hstring>();

					for (const auto& item : models)
					{
						VectorModels.Append(to_hstring(item));
					}

					DataStore::GetInstance().SetModels(VectorModels);

					std::cout << "Model loaded: " << std::boolalpha << modelLoaded << std::endl;
					co_return modelLoaded; // Return the actual result of LoadModels
				}
				else
				{
					co_return false;
				}
			}
			catch (const std::exception& ex) {
				std::cerr << "Exception in CheckandLoadAsync: " << ex.what() << std::endl;
				co_return false; // Return false on error
			}
		}
		else {
			std::cerr << "activeService is null (after initial check)!" << std::endl;
			co_return false;
		}
	}
	else
	{
		std::cerr << "No AI service selected!" << std::endl;
		co_return false;
	}
}

IAsyncAction AIServiceManager::LoadModels()
{
	if (auto strongThis = mainWindowPtr.get())
	{
		if (!strongThis->DispatcherQueue()) {
			std::cerr << "Error: DispatcherQueue is null." << std::endl;
			co_return;
		}

		// Update UI to indicate loading (on UI thread)
		strongThis->DispatcherQueue().TryEnqueue([strongThis]() {
			strongThis->TextBoxElement().PlaceholderText(L"Waiting for your AI buddy to connect!");
			strongThis->TextBoxElement().IsReadOnly(true);
			});

		try {
			// Perform the background operation using co_await
			co_await winrt::resume_background(); // Switch to a background thread
			co_await CheckandLoad(); // Now CheckandLoad runs in the background

			auto action = [strongThis]() {
				strongThis->TextBoxElement().PlaceholderText(L"Ask Anything!");
				strongThis->TextBoxElement().IsReadOnly(false);
				};

			auto asyncAction = strongThis->DispatcherQueue().TryEnqueue(winrt::Microsoft::UI::Dispatching::DispatcherQueuePriority::Normal, action);
		}
		catch (const std::exception& ex)
		{
			std::cerr << "Error during CheckandLoad: " << ex.what() << std::endl;
			strongThis->DispatcherQueue().TryEnqueue([strongThis, message = winrt::to_hstring(ex.what())]() {
				strongThis->TextBoxElement().PlaceholderText(L"Error: " + message);
				strongThis->TextBoxElement().IsReadOnly(true);
				});
			co_return;
		}


		// Update UI after loading (on UI thread)
		strongThis->DispatcherQueue().TryEnqueue([strongThis]() {
			strongThis->TextBoxElement().PlaceholderText(L"Ask Anything!");
			strongThis->TextBoxElement().IsReadOnly(false);
			});
	}
	else {
		std::cerr << "Error: Could not get strong reference to MainWindow." << std::endl;
	}

	co_return;
}

IAsyncOperation<bool> AIServiceManager::TextGeneration(std::string const& model, std::string const& inputText) {
	if (auto ollamaService = dynamic_cast<OllamaService*>(activeService.get()))
	{

	}
	else if (auto googleGeminiService = dynamic_cast<CloudLLMService*>(activeService.get()))
	{
		googleGeminiService->TextGeneration(model, inputText);
	}

	co_return true;
}