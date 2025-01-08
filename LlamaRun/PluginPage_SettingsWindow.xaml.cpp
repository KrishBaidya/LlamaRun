#include "pch.h"
#include "PluginPage_SettingsWindow.xaml.h"
#if __has_include("PluginPage_SettingsWindow.g.cpp")
#include "PluginPage_SettingsWindow.g.cpp"
#endif
#include <winrt/Windows.UI.Xaml.Interop.h>

#include <InstalledPluginsPage.xaml.h>

using namespace winrt;
using namespace Microsoft::UI::Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	void PluginPage_SettingsWindow::PluginNavigationView_SelectionChanged(winrt::Microsoft::UI::Xaml::Controls::NavigationView const& sender, winrt::Microsoft::UI::Xaml::Controls::NavigationViewSelectionChangedEventArgs const& args)
	{
		auto selectedItem = unbox_value<winrt::hstring>(sender.SelectedItem().as<winrt::Microsoft::UI::Xaml::Controls::NavigationViewItem>().Tag());

		if (selectedItem == L"InstalledPlugins")
		{
			ContentFrame().Navigate(winrt::xaml_typename<LlamaRun::InstalledPluginsPage>(), args.RecommendedNavigationTransitionInfo());
		}
		/*
		else if (selectedItem == L"AvailablePlugins")
		{
			ContentFrame().Navigate(winrt::xaml_typename<LlamaRun::AvailablePluginsPage>());
		}*/
	}

	void PluginPage_SettingsWindow::PluginNavigationView_Loaded(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e)
	{
		NavView().SelectedItem(NavView().MenuItems().GetAt(0));
	}

	int32_t PluginPage_SettingsWindow::MyProperty()
	{
		throw hresult_not_implemented();
	}

	void PluginPage_SettingsWindow::MyProperty(int32_t /* value */)
	{
		throw hresult_not_implemented();
	}
}


