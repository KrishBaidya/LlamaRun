#include "pch.h"
#include <winrt/Windows.Storage.h>

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

	void DataStore::SetSelectedModel(const std::string& data)
	{
		OutputDebugString((L"SetSelectedModel called with: " + std::wstring(data.begin(), data.end())).c_str());
		selectedModel = data;
	}

	std::string DataStore::GetSelectedModel()
	{
		OutputDebugString((L"GetSelectedModel returning: " + std::wstring(selectedModel.begin(), selectedModel.end())).c_str());
		return selectedModel;
	}

	float DataStore::GetAppOpacity() const {
		return appOpacity;
	}

	void DataStore::SetAppOpacity(double opacity) {
		appOpacity = opacity;
	}

	Point GetAppDimension() const
	{
		return appDimension;
	}

	void DataStore::SetAppDimension(Point _appDimension)
	{
		appDimension = _appDimension;
	}

	void SetModels(const std::vector<std::string>& data)
	{
		models = data;
	}

	std::vector<std::string> GetModels()
	{
		return models;
	}

private:
	std::string selectedModel = "";
	std::vector<std::string> models;

	float appOpacity = 15.0f;

	Point appDimension = { 38, 10 };

	DataStore() = default;
	~DataStore() = default;
};
