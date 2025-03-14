#pragma once

#include "PluginManagerIntrop.g.h"

namespace winrt::CPythonIntrop::implementation
{
    struct PluginManagerIntrop : PluginManagerIntropT<PluginManagerIntrop>
    {
        void BroadcastEvent(hstring eventName);

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
