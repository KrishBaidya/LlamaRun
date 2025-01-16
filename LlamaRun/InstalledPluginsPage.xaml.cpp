#include "pch.h"
#include "InstalledPluginsPage.xaml.h"
#if __has_include("InstalledPluginsPage.g.cpp")
#include "InstalledPluginsPage.g.cpp"
#endif
#include <SettingsWindow.xaml.h>

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
					catch (const PluginManager::PluginException& ex) {
					}

					});
				auto warningText = TextBlock();
				warningText.Text(L"Do you really want to delete this Plugin");
				removePluginDialog.Content(warningText);
				auto result = co_await removePluginDialog.ShowAsync();
			}
		}
	}

	IAsyncAction InstalledPluginsPage::Install_From_Disk_Button_Click(IInspectable const&, RoutedEventArgs const&)
	{
		Windows::Storage::Pickers::FolderPicker folderPicker;

		auto window = Window();

		auto windowNative{ window.as<::IWindowNative>() };
		HWND hWnd{ 0 };
		windowNative->get_WindowHandle(&hWnd);

		folderPicker.FileTypeFilter().Append(L"*");

		auto initializeWithWindow{ folderPicker.as<::IInitializeWithWindow>() };
		initializeWithWindow->Initialize(hWnd);

		StorageFolder sourceFolder = co_await folderPicker.PickSingleFolderAsync();
		if (sourceFolder == nullptr)
		{
			OutputDebugStringW(L"No folder selected.\n");
			co_return;
		}

		StorageFolder pluginsFolder = co_await StorageFolder::GetFolderFromPathAsync(co_await PluginManager::GetInstance().GetPluginsFolderPath());
		if (pluginsFolder == nullptr) {
			OutputDebugStringW(L"Plugins folder not found.\n");
			co_return;
		}

		hstring sourceFolderName = sourceFolder.Name();

		// A clever way to check if Folder Exists
		try {
			co_await pluginsFolder.GetFolderAsync(sourceFolderName);
			OutputDebugStringW((L"A plugin with the name '" + sourceFolderName + L"' is already installed.\n").c_str());
			co_return;
		}
		catch (...) {

		}

		try
		{
			StorageFolder newDestinationFolder = co_await pluginsFolder.CreateFolderAsync(sourceFolder.Name(), CreationCollisionOption::ReplaceExisting);
			co_await SettingsWindow::CopyFolderAsync(sourceFolder, newDestinationFolder);
		}
		catch (const PluginManager::PluginException& ex)
		{
			//TODO
		}

		OutputDebugStringW((L"Plugin '" + sourceFolderName + L"' installed successfully.\n").c_str());

		PluginManager::GetInstance().LoadAllPlugins();
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

