#pragma once

#include "PluginManagerIntrop.g.h"

#include <Plugin.h>
#include <PluginManager.h>

namespace winrt::CPythonIntrop::implementation
{
	struct PluginManagerIntrop : PluginManagerIntropT<PluginManagerIntrop>
	{
		static winrt::CPythonIntrop::IAppDataProvider m_appDataProvider;

		static IAsyncAction BroadcastEvent(hstring eventName);

		static winrt::Windows::Foundation::Collections::IObservableVector<winrt::Windows::Foundation::IInspectable> Plugins();

		static IAsyncAction RemovePlugin(CPythonIntrop::Plugin plugin);

		static IAsyncOperation<hstring> GetPluginsFolderPath();

		static IAsyncAction LoadAllPlugins();

		static void SetAppDataProvider(winrt::CPythonIntrop::IAppDataProvider const& provider);

		int32_t MyProperty();
		void MyProperty(int32_t value);
	};
}

namespace winrt::CPythonIntrop::factory_implementation
{
	struct PluginManagerIntrop : PluginManagerIntropT<PluginManagerIntrop, implementation::PluginManagerIntrop>
	{
	};
}
