#pragma once
#pragma once
#include <pch.h>

#include <MainWindow.xaml.h>

using namespace winrt;
using namespace Windows::Storage::Streams;
using namespace Windows::Foundation;

class AIService
{
public:
	virtual ~AIService() = default;

	// Abstract methods that must be implemented by derived classes
	virtual IAsyncAction TextGeneration(std::string model, std::string inputText) = 0;

	virtual std::vector<std::string> GetModels() = 0;
	virtual winrt::Windows::Foundation::IAsyncOperation<bool> LoadModels() = 0;

	virtual std::string GetServiceName() = 0;

	virtual void SetMainWindowPtr(winrt::LlamaRun::implementation::MainWindow* mainWindow) {
		this->mainWindow = mainWindow;
	}

	// Optional method for API key (can be implemented by subclasses if needed)
	virtual void SetAPIKey(std::string const& apiKey) {}
	virtual bool isApiKeySet() { return true; }

protected:
	std::vector<std::string> models;

	winrt::LlamaRun::implementation::MainWindow* mainWindow{ nullptr };
};

