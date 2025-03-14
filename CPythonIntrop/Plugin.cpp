#include "pch.h"
#include "Plugin.h"
#if __has_include("Plugin.g.cpp")
#include "Plugin.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::CPythonIntrop::implementation
{
    int32_t Plugin::MyProperty()
    {
        throw hresult_not_implemented();
    }

    void Plugin::MyProperty(int32_t /* value */)
    {
        throw hresult_not_implemented();
    }
}
