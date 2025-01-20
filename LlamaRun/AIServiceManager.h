#pragma once


#include <AIService.h>

#include <MainWindow.xaml.h>

class AIServiceManager
{
public:
	static AIServiceManager& GetInstance();

	void SetActiveService(AIService*);

	void SetActiveServiceByName(std::string const&);

	AIService* GetActiveService();

	IAsyncOperation<bool> CheckandLoad();

	winrt::fire_and_forget LoadModels();

	IAsyncOperation<bool> TextGeneration(std::string const&, std::string const&);

	void SetMainWindowPtr(winrt::LlamaRun::implementation::MainWindow* const& mainWindowPtr) {
		this->mainWindowPtr = mainWindowPtr;
	}

	winrt::LlamaRun::implementation::MainWindow* GetMainWindowPtr() const {
		return this->mainWindowPtr;
	}

private:
	AIService* activeService{ nullptr };

	winrt::LlamaRun::implementation::MainWindow* mainWindowPtr;
};



