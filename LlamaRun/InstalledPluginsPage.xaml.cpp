#include "pch.h"
#include "InstalledPluginsPage.xaml.h"
#if __has_include("InstalledPluginsPage.g.cpp")
#include "InstalledPluginsPage.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	void InstalledPluginsPage::ToggleSwitch_Toggled(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e)
	{
		// Toggle plugin state (enabled/disabled)
		auto plugin = sender.as<winrt::Microsoft::UI::Xaml::Controls::ToggleSwitch>();
		//plugin.IsEnabled = !plugin.IsEnabled;
		auto a = plugin.IsOn();

		// Save plugin state to storage or update configuration.
	}

	void InstalledPluginsPage::InstalledPluginsList_Loaded(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e)
	{
		InstalledPluginsList().ItemsSource(manager.m_plugins);
	}

	int32_t InstalledPluginsPage::MyProperty()
	{
		throw hresult_not_implemented();
	}

	void InstalledPluginsPage::MyProperty(int32_t /* value */)
	{
		throw hresult_not_implemented();
	}
}