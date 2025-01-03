#pragma once

#include "pch.h"
#include <Python/Python.h>
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <json.hpp>
#include <future>

#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>

using namespace winrt;
using namespace Windows::ApplicationModel::AppService;
using namespace Windows::Foundation;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;
using namespace Microsoft::UI::Xaml;
using namespace winrt::Microsoft::UI::Xaml::Media;

class PluginManager {
private:
	static PluginManager& instance;
	std::vector<PyObject*> pluginInstances;
	std::unordered_map<std::string, std::unordered_map<std::string, std::string>> pluginEventMap;

	PluginManager() {
		Py_Initialize();
	}

	~PluginManager() {
		for (auto instance : pluginInstances) {
			Py_XDECREF(instance);
		}
		Py_Finalize();
	}

public:
	static PluginManager& GetInstance()
	{
		static PluginManager instance;
		return instance;
	}

	std::unordered_map<std::string, std::string> eventMethodMap;

	fire_and_forget LoadAllPlugins() {
		try {
			StorageFolder localFolder = ApplicationData::Current().LocalFolder();
			IStorageItem pluginFolder = co_await localFolder.TryGetItemAsync(L"Plugins");

			// Ensure plugin folder exists
			StorageFolder pluginsFolder = nullptr;
			if (pluginFolder == nullptr) {
				std::wcout << L"Plugins folder not found. Creating it..." << std::endl;
				pluginsFolder = co_await ApplicationData::Current().LocalFolder().CreateFolderAsync(L"Plugins");
			}
			else if (auto folder = pluginFolder.try_as<StorageFolder>()) {
				pluginsFolder = folder;
				std::wcout << L"Plugins folder found: " << pluginsFolder.Path().c_str() << std::endl;
			}
			else {
				throw winrt::hresult_error(E_FAIL, L"'Plugins' exists but is not a folder");
			}

			// Get all folders
			auto folders = co_await pluginsFolder.GetFoldersAsync();

			for (const auto& entry : folders) {
				try {
					auto pluginPath = entry.Path();

					// Load and read plugin.json
					auto jsonFile = co_await entry.TryGetItemAsync(L"plugin.json");
					if (!jsonFile) {
						std::wcerr << L"plugin.json not found in " << entry.Name().c_str() << std::endl;
						continue;
					}

					auto storageFile = jsonFile.try_as<StorageFile>();
					if (!storageFile) {
						std::wcerr << L"Failed to access plugin.json in " << entry.Name().c_str() << std::endl;
						continue;
					}

					// Read file contents
					auto fileContent = co_await FileIO::ReadTextAsync(storageFile);
					std::string jsonData = winrt::to_string(fileContent);

					// Parse JSON
					nlohmann::json pluginData = nlohmann::json::parse(jsonData);

					// Add to Python path
					std::string pluginFolderStr = winrt::to_string(pluginPath);
					PyGILState_STATE gstate = PyGILState_Ensure();

					try {
						PyRun_SimpleString(("import sys; sys.path.append(r'" + pluginFolderStr + "')").c_str());

						// Import plugin
						std::string pluginName = pluginData["name"];
						PyObject* pName = PyUnicode_DecodeFSDefault(pluginName.c_str());
						if (!pName) {
							PyErr_Print();
							continue;
						}

						PyObject* pModule = PyImport_Import(pName);
						if (!pModule) {
							PyErr_Print();
							Py_DECREF(pName);
							continue;
						}

						PyObject* pClass = PyObject_GetAttrString(pModule, pluginName.c_str());
						if (pClass && PyCallable_Check(pClass)) {
							PyObject* pInstance = PyObject_CallObject(pClass, nullptr);
							if (pInstance) {
								pluginInstances.emplace_back(pInstance);
								for (const auto& [event, method] : pluginData["actions"].items()) {
									eventMethodMap[event] = method;
								}
							}
							else {
								PyErr_Print();
							}
						}
						else {
							PyErr_Print();
						}

						// Cleanup
						Py_XDECREF(pClass);
						Py_DECREF(pModule);
						Py_DECREF(pName);
					}
					catch (...) {
						std::wcerr << L"Error processing plugin: " << entry.Name().c_str() << std::endl;
					}

					PyGILState_Release(gstate);
				}
				catch (const winrt::hresult_error& ex) {
					std::wcerr << L"Error processing folder: " << entry.Name().c_str()
						<< L" - " << ex.message().c_str() << std::endl;
				}
			}
		}
		catch (const winrt::hresult_error& ex) {
			std::wcerr << L"Critical error in LoadAllPlugins: " << ex.message().c_str() << std::endl;
		}
	}

	void BroadcastEvent(const std::string& eventName) {
		// Look up the method name associated with the event
		auto it = eventMethodMap.find(eventName);
		if (it != eventMethodMap.end()) {
			const std::string& methodName = it->second;
			for (auto& pluginInstance : pluginInstances) {
				PyObject_CallMethod(pluginInstance, methodName.c_str(), nullptr);  // Call method based on method name
			}
		}
		else {
			std::cerr << "Event " << eventName << " not found in eventMethodMap." << std::endl;
		}
	}
};