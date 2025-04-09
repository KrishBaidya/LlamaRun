#include <pch.h>

#include "PluginManagerIntrop.h"
#if __has_include("PluginManagerIntrop.g.cpp")
#include "PluginManagerIntrop.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::CPythonIntrop::implementation
{
	winrt::CPythonIntrop::IAppDataProvider PluginManagerIntrop::m_appDataProvider{ nullptr };

	void PluginManagerIntrop::SetAppDataProvider(winrt::CPythonIntrop::IAppDataProvider const& provider)
	{
		m_appDataProvider = provider; // Store the provided interface implementation
		// Optional: Add logging
		OutputDebugString(L"CPythonIntrop: AppDataProvider has been set.\n");
	}

	IAsyncAction PluginManagerIntrop::BroadcastEvent(hstring eventName) {
		return PluginManager::GetInstance().BroadcastEvent(to_string(eventName));
	}

	Windows::Foundation::Collections::IObservableVector<winrt::Windows::Foundation::IInspectable> PluginManagerIntrop::Plugins()
	{
		return PluginManager::GetInstance().m_plugins;
	}

	IAsyncAction PluginManagerIntrop::RemovePlugin(CPythonIntrop::Plugin plugin) {
		return PluginManager::GetInstance().RemovePlugin(plugin);
	}

	IAsyncOperation<hstring> PluginManagerIntrop::GetPluginsFolderPath() {
		return PluginManager::GetInstance().GetPluginsFolderPath();
	}

	IAsyncAction PluginManagerIntrop::LoadAllPlugins() {
		return PluginManager::GetInstance().LoadAllPlugins();
	}

	int32_t PluginManagerIntrop::MyProperty()
	{
		throw hresult_not_implemented();
	}

	void PluginManagerIntrop::MyProperty(int32_t /* value */)
	{
		throw hresult_not_implemented();
	}
}
