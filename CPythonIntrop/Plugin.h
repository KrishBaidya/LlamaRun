#pragma once

#include "Plugin.g.h"

namespace winrt::CPythonIntrop::implementation
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

		winrt::hstring m_pluginFolderPath;

		bool m_isPluginEnabled = false;

	public:
		Plugin() = default; // Default constructor

		Plugin(const winrt::hstring& name,
			const winrt::hstring& description,
			const winrt::hstring& version,
			const winrt::hstring& author,
			const std::unordered_map<std::string, std::string>& actions,
			PyObject* instance,
			const winrt::hstring& pluginFolderPath,
			bool isEnabled = true)
			: m_pluginName(name), m_pluginDescription(description),
			m_pluginVersion(version), m_pluginAuthor(author),
			m_pluginActions(actions), m_pluginInstance(instance),
			m_pluginFolderPath(pluginFolderPath),
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

		std::unordered_map<std::string, std::string> PluginActions() {
			return m_pluginActions;
		}

		void PluginActions(std::unordered_map<std::string, std::string> const& value)
		{
			m_pluginActions = value;
		}

		PyObject* PluginInstance() const
		{
			return m_pluginInstance;
		}

		void PluginInstance(PyObject* const& value)
		{
			m_pluginInstance = value;
		}

		winrt::hstring PluginFolderPath() const {
			return m_pluginFolderPath;
		}

		void PluginFolderPath(winrt::hstring const& value) {
			m_pluginFolderPath = value;
		}
	};
}

namespace winrt::CPythonIntrop::factory_implementation
{
    struct Plugin : PluginT<Plugin, implementation::Plugin>
    {
    };
}
