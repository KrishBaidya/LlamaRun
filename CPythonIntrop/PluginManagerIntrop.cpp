#include "pch.h"
#include "PluginManagerIntrop.h"
#if __has_include("PluginManagerIntrop.g.cpp")
#include "PluginManagerIntrop.g.cpp"
#endif

#include <PluginManager.h>

using namespace winrt;
using namespace Microsoft::UI::Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::CPythonIntrop::implementation
{
    void PluginManagerIntrop::BroadcastEvent(hstring eventName) {
		OutputDebugString(L"Broadcasting event... ");
		OutputDebugString(eventName.c_str());
		PluginManager::GetInstance().LoadAllPlugins();
        PluginManager::GetInstance().BroadcastEvent(to_string(eventName));
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
