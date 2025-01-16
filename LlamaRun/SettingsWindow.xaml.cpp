#include "pch.h"
#include "SettingsWindow.xaml.h"
#if __has_include("SettingsWindow.g.cpp")
#include "SettingsWindow.g.cpp"
#endif
#include <DataStore.cpp>

#include <PluginPage_SettingsWindow.xaml.h>
#include <HomePage_SettingsWindow.xaml.h>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace winrt::Microsoft::UI::Xaml::Media;
using namespace Windows::Foundation;
using namespace Windows::Storage;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
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

	Windows::Foundation::IAsyncAction SettingsWindow::CopyFolderAsync(const StorageFolder& sourceFolder, const StorageFolder& destinationFolder)
	{
		try
		{
			// Copy files in the current folder
			auto files = co_await sourceFolder.GetFilesAsync();
			for (auto const& file : files)
			{
				co_await file.CopyAsync(destinationFolder, file.Name(), NameCollisionOption::ReplaceExisting);
			}

			// Recursively copy subfolders
			auto folders = co_await sourceFolder.GetFoldersAsync();
			for (auto const& folder : folders)
			{
				auto newDestinationFolder = co_await destinationFolder.CreateFolderAsync(folder.Name(), CreationCollisionOption::OpenIfExists);
				co_await CopyFolderAsync(folder, newDestinationFolder); // Recursive call
			}
		}
		catch (winrt::hresult_error const& ex)
		{
			winrt::hstring errorMessage = L"Error copying folder: " + ex.message();
			OutputDebugStringW(errorMessage.c_str());
		}
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

	void SettingsWindow::NavigationView_SelectionChanged(winrt::Microsoft::UI::Xaml::Controls::NavigationView const& sender, winrt::Microsoft::UI::Xaml::Controls::NavigationViewSelectionChangedEventArgs const& args)
	{
		auto selectedItem = unbox_value<winrt::hstring>(sender.SelectedItem().as<winrt::Microsoft::UI::Xaml::Controls::NavigationViewItem>().Tag());

		if (selectedItem == L"Home") {
			ContentFrame().Navigate(winrt::xaml_typename<LlamaRun::HomePage_SettingsWindow>(), args.RecommendedNavigationTransitionInfo());
		}
		else if (selectedItem == L"Plugins") {
			ContentFrame().Navigate(winrt::xaml_typename<LlamaRun::PluginPage_SettingsWindow>(), nullptr, args.RecommendedNavigationTransitionInfo());
		}
	}

	void SettingsWindow::NavigationView_Loaded(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e)
	{
		NavView().SelectedItem(NavView().MenuItems().GetAt(0));
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

