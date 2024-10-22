#include "pch.h"
#include "SettingsWindow.xaml.h"
#if __has_include("SettingsWindow.g.cpp")
#include "SettingsWindow.g.cpp"
#endif
#include <DataStore.cpp>
#include <winrt/Windows.Storage.h>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace winrt::Microsoft::UI::Xaml::Media;
using namespace Windows::Foundation;
using namespace Windows::Storage;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	void SettingsWindow::MyComboBox_Loaded(IInspectable const&, IInspectable const& args)
	{
		auto models = DataStore::GetInstance().GetModels();

		if (SettingsWindow::LoadSetting("SelectedModel") != L"")
		{
			auto selectedModel = SettingsWindow::LoadSetting("SelectedModel");
			DataStore::GetInstance().SetSelectedModel(to_string(selectedModel.data()));
		}

		auto selectedModel = DataStore::GetInstance().GetSelectedModel();
		for (auto& model : models)
		{
			auto newItem = winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem();
			newItem.Content(winrt::box_value(to_hstring(model)));
			MyComboBox().Items().Append(newItem);

			if (selectedModel == model)
			{
				MyComboBox().SelectedItem(newItem);
			}
		}
	}

	void SettingsWindow::SaveButtonClicked(IInspectable const&, IInspectable const& args) {
		auto selectedModelIndex = MyComboBox().SelectedIndex();
		auto selectedModel = DataStore::GetInstance().GetModels()[selectedModelIndex];

		SaveSetting("SelectedModel", selectedModel);
	}

	void SettingsWindow::SaveSetting(const std::string& key, const std::string& value)
	{
		ApplicationDataContainer localSettings{ Windows::Storage::ApplicationData::Current().LocalSettings() };

		localSettings.Values().Insert(to_hstring(key), box_value(to_hstring(value)));
	}

	std::wstring SettingsWindow::LoadSetting(const std::string& key)
	{
		ApplicationDataContainer localSettings{ Windows::Storage::ApplicationData::Current().LocalSettings() };

		auto values{ localSettings.Values() };

		auto result = values.Lookup(to_hstring(key));

		if (result)
		{
			try
			{
				winrt::hstring value = winrt::unbox_value<winrt::hstring>(result);
				OutputDebugString(value.c_str());

				return winrt::unbox_value<winrt::hstring>(box_value(value)).c_str();
			}
			catch (const winrt::hresult_error& ex)
			{
				OutputDebugStringW(L"Failed to unbox the value.\n");
			}
		}

		return L"";
	}

	fire_and_forget SettingsWindow::RequestStartup()
	{
		auto& startupTask = co_await winrt::Windows::ApplicationModel::StartupTask::GetAsync(L"LLamaRun Generation");
		switch (startupTask.State())
		{
		case winrt::Windows::ApplicationModel::StartupTaskState::Disabled:
			// Request user permission to enable startup
			co_await startupTask.RequestEnableAsync();
			break;

		case winrt::Windows::ApplicationModel::StartupTaskState::DisabledByUser:
			co_await startupTask.RequestEnableAsync();
			break;

		case winrt::Windows::ApplicationModel::StartupTaskState::DisabledByPolicy:
			// Startup disabled by group policy
			break;

		case winrt::Windows::ApplicationModel::StartupTaskState::Enabled:
			// Already enabled
			break;
		}
	}

	int32_t SettingsWindow::MyProperty()
	{
		throw hresult_not_implemented();
	}

	void SettingsWindow::MyProperty(int32_t /* value */)
	{
		throw hresult_not_implemented();
	}
}
