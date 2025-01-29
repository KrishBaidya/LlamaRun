#pragma once


#include <AIService.h>

#include <MainWindow.xaml.h>

class AIServiceManager
{
public:
	static AIServiceManager& GetInstance();

	void SetActiveService(std::unique_ptr<AIService>);

	void SetActiveServiceByName(std::string const&);

	AIService* GetActiveService() const&;

	IAsyncOperation<bool> CheckandLoad();

	IAsyncAction LoadModels();

	IAsyncOperation<bool> TextGeneration(std::string const&, std::string const&);

	void SetMainWindowPtr(winrt::weak_ref<winrt::LlamaRun::implementation::MainWindow> mainWindowPtr) {
		this->mainWindowPtr = mainWindowPtr;
	}

	winrt::weak_ref<winrt::LlamaRun::implementation::MainWindow> GetMainWindowPtr() const {
		return this->mainWindowPtr;
	}

private:
	std::unique_ptr<AIService> activeService;

	winrt::weak_ref<winrt::LlamaRun::implementation::MainWindow> mainWindowPtr{ nullptr };
};
