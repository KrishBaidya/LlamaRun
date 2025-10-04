using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;

namespace LlamaRun.MCPServers
{
    public sealed partial class ConfigPreviewDialog : ContentDialog
    {
        private readonly List<MCP_Server> _servers;

        private static readonly JsonSerializerOptions s_writeOptions = new()
        {
            WriteIndented = true
        };

        private static readonly JsonSerializerOptions s_readOptions = new()
        {
            AllowTrailingCommas = true
        };

        static string Serialize<T>(T value)
        {
            return JsonSerializer.Serialize(value, s_writeOptions);
        }

        static T? Deserialize<T>(string json)
        {
            return JsonSerializer.Deserialize<T>(json, s_readOptions);
        }

        public ConfigPreviewDialog(List<MCP_Server> servers)
        {
            this.InitializeComponent();
            _servers = servers;

            //Accepts Tab
            JsonEditor.KeyDown += JsonEditor_KeyDown;

            // Pretty-print JSON into editor
            JsonEditor.Text = Serialize(servers);
        }

        private void JsonEditor_KeyDown(object sender, KeyRoutedEventArgs e)
        {
            if (e.Key == Windows.System.VirtualKey.Tab)
            {
                var tb = (TextBox)sender;
                int pos = tb.SelectionStart;

                tb.Text = tb.Text.Insert(pos, "    "); // Insert 4 spaces
                tb.SelectionStart = pos + 4;
                e.Handled = true;
            }
        }

        public List<MCP_Server>? GetUpdatedServers()
        {
            try
            {
                return Deserialize<List<MCP_Server>>(JsonEditor.Text);
            }
            catch (Exception ex)
            {
                // Invalid JSON entered by user
                Debug.WriteLine("JSON Error: " + ex.Message);
                return null;
            }
        }
    }
}
