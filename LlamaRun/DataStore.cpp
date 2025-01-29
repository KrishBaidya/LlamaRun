#pragma once

#include "pch.h"
#include <SettingsWindow.xaml.h>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Storage;

class DataStore
{
public:
	static DataStore& GetInstance()
	{
		static DataStore instance;
		return instance;
	}

	DataStore& DataStore::SetSelectedModel(const std::string& data)
	{
		OutputDebugString((L"SetSelectedModel called with: " + std::wstring(data.begin(), data.end())).c_str());
		selectedModel = data;

		return *this;
	}

	std::string DataStore::GetSelectedModel() const
	{
		OutputDebugString((L"GetSelectedModel returning: " + std::wstring(selectedModel.begin(), selectedModel.end())).c_str());
		return selectedModel;
	}

	void SaveSelectedModel() const {
		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("SelectedModel", selectedModel);
	}

	void LoadSelectedModel() {
		selectedModel = to_string(winrt::LlamaRun::implementation::SettingsWindow::LoadSetting("SelectedModel"));
	}

	float DataStore::GetAppOpacity() const {
		return appOpacity;
	}

	DataStore& DataStore::SetAppOpacity(double opacity) {
		appOpacity = opacity;

		return *this;
	}

	void SaveAppOpacity() const {
		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("AppOpacity", to_hstring(appOpacity));
	}

	void LoadAppOpacity() {
		appOpacity = std::stof(to_string(winrt::LlamaRun::implementation::SettingsWindow::LoadSetting("AppOpacity")));
	}

	Point GetAppDimension() const
	{
		return appDimension;
	}

	DataStore& DataStore::SetAppDimension(Point _appDimension)
	{
		appDimension = _appDimension;

		return *this;
	}

	void SaveAppDimension() const {
		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("Width", to_hstring(appDimension.X));
		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("Height", to_hstring(appDimension.Y));
	}

	void LoadAppDimension() {
		float const& width = std::stof(to_string(winrt::LlamaRun::implementation::SettingsWindow::LoadSetting("Width")));
		float const& height = std::stof(to_string(winrt::LlamaRun::implementation::SettingsWindow::LoadSetting("Height")));

		Point const& point = { width, height };

		this->appDimension = point;
	}

	DataStore& SetModels(const winrt::Windows::Foundation::Collections::IVector<winrt::hstring>& data)
	{
		models = data;

		return *this;
	}

	winrt::Windows::Foundation::Collections::IVector<winrt::hstring> GetModels()
	{
		return models;
	}

	DataStore& SetModelService(std::string const& service) {
		if (service.empty())
		{

		}
		else
		{
			selectedService = service;
		}

		return *this;
	}

	std::string GetModelService() {
		return selectedService;
	}

	void SaveModelService() const {
		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("ModelService", selectedService);
	}

	DataStore& LoadModelService() {
		selectedService = to_string(winrt::LlamaRun::implementation::SettingsWindow::LoadSetting("ModelService"));

		return *this;
	}

	DataStore& SetAPIKeyForProvider(const std::string& provider, const std::string& apiKey) {
		providerAPIKeys[provider] = apiKey;

		return *this;
	}

	std::string GetAPIKeyForProvider(const std::string& provider) {
		return providerAPIKeys[provider];
	}

	void SaveAPIKeys() const {

		auto map = winrt::single_threaded_map<winrt::hstring, winrt::hstring>();

		for (const auto& pair : providerAPIKeys) {
			map.Insert(to_hstring(pair.first), to_hstring(pair.second));
		}

		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("APIKeys", winrt::box_value(map));
	}

	void LoadAPIKeys() {
		selectedService = to_string(winrt::LlamaRun::implementation::SettingsWindow::LoadSetting("APIKeys"));
	}

private:
	std::string selectedModel = "";
	winrt::Windows::Foundation::Collections::IVector<winrt::hstring> models{ nullptr };

	float appOpacity = 15.0f;

	Point appDimension = { 38, 10 };

	std::string selectedService = "";
	std::unordered_map<std::string, std::string> providerAPIKeys;

	DataStore() = default;
	~DataStore() = default;
};
