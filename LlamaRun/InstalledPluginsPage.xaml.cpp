#include "pch.h"
#include "InstalledPluginsPage.xaml.h"
#if __has_include("InstalledPluginsPage.g.cpp")
#include "InstalledPluginsPage.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace winrt::Microsoft::UI::Composition;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	void InstalledPluginsPage::InstalledPluginsList_Loaded(IInspectable const& sender, RoutedEventArgs const& e)
	{
		winrt::Microsoft::UI::Xaml::Data::Binding binding;
		binding.Mode(winrt::Microsoft::UI::Xaml::Data::BindingMode::TwoWay);
		binding.Source(PluginManager::GetInstance().m_plugins);
		InstalledPluginsList().SetBinding(winrt::Microsoft::UI::Xaml::Controls::ItemsControl::ItemsSourceProperty(), binding);
	}

	void InstalledPluginsPage::Delete_Click(IInspectable const& sender, winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e)
	{
		auto data = sender.as<FrameworkElement>().DataContext();
		if (auto plugin = data.try_as<LlamaRun::Plugin>()) 
		{
			//plugin.isPluginEnabled(false);
		}
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

