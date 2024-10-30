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
	void SettingsWindow::rootPanel_Loaded(IInspectable const& sender, RoutedEventArgs const& e)
	{
		if (SettingsWindow::LoadSetting("App Width") != L"")
		{
			auto appWidth = SettingsWindow::LoadSetting("App Width");

			MainWindowWidth().Value(std::stod(to_string(appWidth)));
		}
		else {
			MainWindowWidth().Value(38);
		}
		if (SettingsWindow::LoadSetting("App Height") != L"")
		{
			auto appHeight = SettingsWindow::LoadSetting("App Height");

			MainWindowHeight().Value(std::stod(to_string(appHeight)));
		}
		else {
			MainWindowHeight().Value(10);
		}

		if (SettingsWindow::LoadSetting("App Opacity") != L"")
		{
			auto appOpacity = SettingsWindow::LoadSetting("App Opacity");

			MainWindowOpacitySlider().Value(std::stod(to_string(appOpacity)));
		}
	}

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
		std::string selectedModel = DataStore::GetInstance().GetModels()[selectedModelIndex];

		const auto& AppHeight = MainWindowHeight().Value();
		const auto& AppWidth = MainWindowWidth().Value();

		SaveSetting("SelectedModel", selectedModel);

		SaveSetting("App Height", to_hstring(AppHeight));
		SaveSetting("App Width", to_hstring(AppWidth));

		SaveSetting("App Opacity", to_hstring(MainWindowOpacitySlider().Value()));

		RequestStartupChange(AutoStartUpCheckBox().IsChecked().GetBoolean());

		DataStore::GetInstance().SetAppDimension({ static_cast<float>(AppWidth), static_cast<float>(AppHeight) });
	}

	void SettingsWindow::SaveSetting(const std::string& key, const std::string& value)
	{
		ApplicationDataContainer localSettings{ Windows::Storage::ApplicationData::Current().LocalSettings() };

		localSettings.Values().Insert(to_hstring(key), box_value(to_hstring(value)));
	}

	void SettingsWindow::SaveSetting(const std::string& key, const hstring& value)
	{
		ApplicationDataContainer localSettings{ Windows::Storage::ApplicationData::Current().LocalSettings() };

		localSettings.Values().Insert(to_hstring(key), box_value(value));
	}

	winrt::hstring SettingsWindow::LoadSetting(const std::string& key)
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

				return value;
			}
			catch (const winrt::hresult_error& ex)
			{
				OutputDebugStringW(L"Failed to unbox the value.\n");
			}
		}

		return L"";
	}

	fire_and_forget SettingsWindow::RequestStartupChange(const bool& Enable)
	{
		auto& startupTask = co_await winrt::Windows::ApplicationModel::StartupTask::GetAsync(L"LLamaRun Generation");

		if (Enable)
		{
			co_await startupTask.RequestEnableAsync();
		}
		else {
			startupTask.Disable();
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
