#pragma once

#include "Plugin.g.h"

#include <pch.h>

namespace winrt::LlamaRun::implementation
{
	struct Plugin : PluginT<Plugin>
	{
	private:
		winrt::hstring m_pluginName;
		winrt::hstring m_pluginDescription;
		winrt::hstring m_pluginVersion;
		winrt::hstring m_pluginAuthor;
		std::unordered_map<std::string, std::string> m_pluginActions;

		PyObject* m_pluginInstance = nullptr;

		bool m_isPluginEnabled = false;

	public:
		Plugin() = default; // Default constructor

		Plugin(const winrt::hstring& name,
			const winrt::hstring& description,
			const winrt::hstring& version,
			const winrt::hstring& author,
			const std::unordered_map<std::string, std::string>& actions,
			PyObject* instance,
			bool isEnabled = true)
			: m_pluginName(name), m_pluginDescription(description),
			m_pluginVersion(version), m_pluginAuthor(author),
			m_pluginActions(actions), m_pluginInstance(instance),
			m_isPluginEnabled(isEnabled)
		{
		}

		int32_t MyProperty();
		void MyProperty(int32_t value);

		winrt::hstring PluginName() const
		{
			return m_pluginName;
		}

		void PluginName(winrt::hstring const& value)
		{
			m_pluginName = value;
		}

		winrt::hstring PluginDescription() const
		{
			return m_pluginDescription;
		}

		void PluginDescription(winrt::hstring const& value)
		{
			m_pluginDescription = value;
		}

		winrt::hstring PluginVersion() const
		{
			return m_pluginVersion;
		}

		void PluginVersion(winrt::hstring const& value)
		{
			m_pluginVersion = value;
		}

		winrt::hstring PluginAuthor() const
		{
			return m_pluginAuthor;
		}

		void PluginAuthor(winrt::hstring const& value)
		{
			m_pluginAuthor = value;
		}

		bool isPluginEnabled() const 
		{
			return m_isPluginEnabled;
		}

		void isPluginEnabled(bool const& value) 
		{
			m_isPluginEnabled = value;
		}
	};
}

namespace winrt::LlamaRun::factory_implementation
{
	struct Plugin : PluginT<Plugin, implementation::Plugin>
	{
	};
}
