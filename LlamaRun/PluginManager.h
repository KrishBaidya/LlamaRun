#pragma once

#include "pch.h"
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <json.hpp>
#include <future>

#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>

#include <winrt/Windows.UI.Xaml.Data.h>

#include <Plugin.h>

using namespace winrt;
using namespace Windows::ApplicationModel::AppService;
using namespace Windows::Foundation;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;
using namespace Microsoft::UI::Xaml;
using namespace winrt::Microsoft::UI::Xaml::Media;

class PluginManager {

public:

	PluginManager() {
		Py_Initialize();
	}

	~PluginManager() {
		Py_Finalize();
	}

	static PluginManager& GetInstance() {
		static PluginManager instance;
		return instance;
	}

	winrt::Windows::Foundation::Collections::IObservableVector<winrt::Windows::Foundation::IInspectable> m_plugins{ winrt::single_threaded_observable_vector<winrt::Windows::Foundation::IInspectable>() };

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
					auto jsonFile = co_await entry.TryGetItemAsync(L"plugin.json");
					if (!jsonFile) {
						std::wcerr << L"plugin.json not found in " << entry.Name().c_str() << std::endl;
						continue;
					}

					auto storageFile = jsonFile.try_as<StorageFile>();

					auto fileContent = co_await FileIO::ReadTextAsync(storageFile);
					std::string jsonData = winrt::to_string(fileContent);
					nlohmann::json pluginData = nlohmann::json::parse(jsonData);

					std::string pluginName = pluginData["name"];
					std::string pluginDescription = pluginData["description"];
					std::string pluginVersion = pluginData["version"];
					std::string pluginAuthor = pluginData["author"];
					std::unordered_map<std::string, std::string> pluginActions = pluginData["actions"].get<std::unordered_map<std::string, std::string>>();

					std::string pluginFolderStr = winrt::to_string(pluginPath);
					PyGILState_STATE gstate = PyGILState_Ensure();

					try {
						PyRun_SimpleString(("import sys; sys.path.append(r'" + pluginFolderStr + "')").c_str());

						// Import plugin
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
								//winrt::make_self<winrt::LlamaRun::Plugin>(L"PluginName", L"Description", L"1.0", L"Author", pluginActions, nullptr);
								m_plugins.Append(winrt::make<LlamaRun::implementation::Plugin>(to_hstring(pluginName), to_hstring(pluginDescription), to_hstring(pluginVersion), to_hstring(pluginAuthor), pluginActions, pInstance, true));
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

					// Continue cleanup and handling
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
		PyGILState_STATE gstate = PyGILState_Ensure(); // Acquire GIL

		for (auto& pluginInspectable : m_plugins) {
			auto const& plugin = pluginInspectable.as<LlamaRun::implementation::Plugin>().get();

			if (!plugin || !plugin->isPluginEnabled()) {
				continue;
			}

			auto const& actions = plugin->PluginActions();
			auto it = actions.find(eventName);

			if (it != actions.end()) {
				std::string methodName = it->second;
				if (!methodName.empty()) {
					PyObject* result = PyObject_CallMethod(plugin->PluginInstance(), methodName.c_str(), nullptr);
					if (result == nullptr) {
						PyErr_Print(); // Print any Python errors
					}
					else {
						Py_DECREF(result); // Clean up the result if call was successful
					}
				}
			}
			else {
				std::cerr << "Event " << eventName << " not found in plugin " << to_string(plugin->PluginName()) << std::endl;
			}
		}

		PyGILState_Release(gstate); // Release GIL
	}
};