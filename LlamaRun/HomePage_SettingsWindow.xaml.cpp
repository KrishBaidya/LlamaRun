#include "pch.h"
#include "HomePage_SettingsWindow.xaml.h"
#if __has_include("HomePage_SettingsWindow.g.cpp")
#include "HomePage_SettingsWindow.g.cpp"
#endif

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	static IAsyncOperation<bool> CheckStartUp()
	{
		auto& startupTask = co_await winrt::Windows::ApplicationModel::StartupTask::GetAsync(L"LLamaRun Generation");

		switch (startupTask.State())
		{
		case winrt::Windows::ApplicationModel::StartupTaskState::Disabled:
			co_return false;

		case winrt::Windows::ApplicationModel::StartupTaskState::DisabledByUser:
			co_return false;

		case winrt::Windows::ApplicationModel::StartupTaskState::DisabledByPolicy:
			co_return false;

		case winrt::Windows::ApplicationModel::StartupTaskState::Enabled:
			co_return true;

		case winrt::Windows::ApplicationModel::StartupTaskState::EnabledByPolicy:
			co_return true;
		}
	}

    int32_t HomePage_SettingsWindow::MyProperty()
    {
        throw hresult_not_implemented();
    }

    void HomePage_SettingsWindow::MyProperty(int32_t /* value */)
    {
        throw hresult_not_implemented();
    }

	void HomePage_SettingsWindow::rootPanel_Loaded(IInspectable const& sender, RoutedEventArgs const& e)
	{
		if (SettingsWindow::LoadSetting("App Width") != L"")
		{
			auto appWidth = SettingsWindow::LoadSetting("App Width");
			
			MainWindowHeight().Value(std::stod(to_string(appWidth)));
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
		else {
			MainWindowOpacitySlider().Value(15);
		}

		if (SettingsWindow::LoadSetting("Startup Enabled") != L"")
		{
			auto StartupEnabled = SettingsWindow::LoadSetting("Startup Enabled");
			bool _StartUpEnabled = false;
			std::istringstream(to_string(StartupEnabled)) >> std::boolalpha >> _StartUpEnabled;
			AutoStartUpCheckBox().IsChecked(_StartUpEnabled);
		}
		else {
			CheckStartUp().Completed([&](auto&& sender, AsyncStatus const  asyncStatus) {
				bool _StartUpEnabled = sender.GetResults();
				AutoStartUpCheckBox().IsChecked(_StartUpEnabled);
				});
		}
	}

	void HomePage_SettingsWindow::MyComboBox_Loaded(IInspectable const&, IInspectable const& args)
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

	fire_and_forget HomePage_SettingsWindow::RequestStartupChange(bool Enable)
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

	void HomePage_SettingsWindow::SaveButtonClicked(IInspectable const&, IInspectable const& args) {
		auto selectedModelIndex = MyComboBox().SelectedIndex();
		std::string selectedModel = DataStore::GetInstance().GetModels()[selectedModelIndex];

		const auto& AppHeight = MainWindowHeight().Value();
		const auto& AppWidth = MainWindowWidth().Value();

		const auto& AppOpacity = MainWindowOpacitySlider().Value();

		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("SelectedModel", selectedModel);

		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("App Height", to_hstring(AppHeight));
		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("App Width", to_hstring(AppWidth));

		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("App Opacity", to_hstring(AppOpacity));

		RequestStartupChange(AutoStartUpCheckBox().IsChecked().GetBoolean());

		winrt::LlamaRun::implementation::SettingsWindow::SaveSetting("Startup Enabled", to_hstring(AutoStartUpCheckBox().IsChecked().GetBoolean()));

		DataStore::GetInstance().SetAppOpacity(AppOpacity);
		DataStore::GetInstance().SetAppDimension({ static_cast<float>(AppWidth), static_cast<float>(AppHeight) });
	}
}
