#include "pch.h"
#include "InstalledPluginsPage.xaml.h"
#if __has_include("InstalledPluginsPage.g.cpp")
#include "InstalledPluginsPage.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace winrt::Microsoft::UI::Composition;
using namespace winrt::Microsoft::UI::Xaml::Controls;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	void InstalledPluginsPage::InstalledPluginsList_Loaded(IInspectable const&, RoutedEventArgs const&)
	{
		winrt::Microsoft::UI::Xaml::Data::Binding binding;
		binding.Mode(winrt::Microsoft::UI::Xaml::Data::BindingMode::TwoWay);
		binding.Source(PluginManager::GetInstance().m_plugins);
		InstalledPluginsList().SetBinding(winrt::Microsoft::UI::Xaml::Controls::ItemsControl::ItemsSourceProperty(), binding);
	}

	fire_and_forget InstalledPluginsPage::Delete_Click(IInspectable const& sender, RoutedEventArgs const&)
	{
		if (auto item = sender.as<MenuFlyoutItem>())
		{
			if (auto plugin = item.DataContext().as<LlamaRun::Plugin>())
			{
				ContentDialog removePluginDialog = ContentDialog();
				removePluginDialog.XamlRoot(this->XamlRoot());
				removePluginDialog.Title(box_value(L"Remove Plugin?"));
				removePluginDialog.PrimaryButtonText(L"Yes");
				removePluginDialog.CloseButtonText(L"Cancel");
				removePluginDialog.DefaultButton(ContentDialogButton::Primary);

				removePluginDialog.PrimaryButtonClick([&](IInspectable const&, IInspectable const&) -> fire_and_forget {

					uint32_t i = 0;
					PluginManager::GetInstance().m_plugins.IndexOf(plugin, i);

					try
					{
						co_await PluginManager::GetInstance().RemovePlugin(plugin);
						PluginManager::GetInstance().m_plugins.RemoveAt(i);
					}
					catch (const PluginManager::PluginRemovalException& ex) {
						removePluginDialog.Hide();
						ContentDialog errorDialog = ContentDialog();
						errorDialog.XamlRoot(this->XamlRoot());
						errorDialog.Title(box_value(L"Error Cannot Remove Plugin!! " + ex.message()));
						errorDialog.CloseButtonText(L"Okay");
					}

					});
				auto warningText = TextBlock();
				warningText.Text(L"Do you really want to delete this Plugin");
				removePluginDialog.Content(warningText);
				auto result = co_await removePluginDialog.ShowAsync();
			}
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

