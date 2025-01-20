#pragma once
#include "pch.h"
#include "AIServiceManager.h"

#include <DataStore.cpp>

AIServiceManager& AIServiceManager::GetInstance()
{
	static AIServiceManager instance;
	return instance;
}

void AIServiceManager::SetActiveService(AIService* service)
{
	activeService = service;
}

void AIServiceManager::SetActiveServiceByName(std::string const& service)
{
	/*if (service == "Ollama")
	{
		AIServiceManager::GetInstance().SetActiveService(&OllamaService());
	}
	else if (service == "Google Gemini")
	{
		AIServiceManager::GetInstance().SetActiveService(&GoogleGeminiService());
	}*/
}

AIService* AIServiceManager::GetActiveService()
{
	return activeService;
}

IAsyncOperation<bool> AIServiceManager::CheckandLoad()
{
	if (activeService)
	{
		/*auto ollamaService = dynamic_cast<OllamaService*>(activeService);
		if (ollamaService)
		{
			bool modelLoaded = co_await ollamaService->CheckandLoadOllama();
			DataStore::GetInstance().SetModels(ollamaService->GetModels());
			std::cout << "Ollama model loaded: " << std::boolalpha << modelLoaded << std::endl;
		}
		else
		{
			bool modelLoaded = co_await activeService->LoadModels();
			DataStore::GetInstance().SetModels(activeService->GetModels());
			std::cout << "Model loaded: " << std::boolalpha << modelLoaded << std::endl;
		}*/

		co_return true;
	}
	else
	{
		std::cerr << "No AI service selected!" << std::endl;

		co_return false;
	}
}

winrt::fire_and_forget AIServiceManager::LoadModels()
{
	if (auto& weakThis = *mainWindowPtr)
	{
		std::thread serverCheckThread([&]() -> IAsyncAction {
			if (weakThis && weakThis.DispatcherQueue()) { // Check for both 'this' and DispatcherQueue
				weakThis.DispatcherQueue().TryEnqueue(
					winrt::Microsoft::UI::Dispatching::DispatcherQueuePriority::Normal,
					[&weakThis]() {
						weakThis.TextBoxElement().PlaceholderText(L"Waiting for Ollama server!");
						weakThis.TextBoxElement().IsReadOnly(true);
					}
				);
			}
			while (!ollama::is_running()) {
				std::this_thread::sleep_for(std::chrono::seconds(1));
			}

			co_await CheckandLoad();

			if (weakThis && weakThis.DispatcherQueue()) { // Check for both 'this' and DispatcherQueue
				weakThis.DispatcherQueue().TryEnqueue(
					winrt::Microsoft::UI::Dispatching::DispatcherQueuePriority::Normal,
					[&weakThis]() {
						weakThis.TextBoxElement().PlaceholderText(L"Ask Anything!");
						weakThis.TextBoxElement().IsReadOnly(false);
					}
				);
			}
			});

		serverCheckThread.detach();
	}

	co_return;
}

IAsyncOperation<bool> AIServiceManager::TextGeneration(std::string const& model, std::string const& inputText) {
	/*if (auto ollamaService = dynamic_cast<OllamaService*>(activeService))
	{

	}
	else if (auto googleGeminiService = dynamic_cast<GoogleGeminiService*>(activeService))
	{
		googleGeminiService->TextGeneration(model, inputText);
	}*/

	co_return true;
}