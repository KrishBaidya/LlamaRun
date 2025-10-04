using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace LlamaRun.MCPServers
{
    public static class MCPServerExtensions
    {
        /// <summary>
        /// Converts MCPServerInfo from MCP Directory to MCP_Server for LlamaRun
        /// </summary>
        public static MCP_Server ToMCPServer(this MCPServerInfo serverInfo)
        {
            if (string.IsNullOrEmpty(serverInfo.name))
                throw new ArgumentException("Server name cannot be null or empty");

            var mcpServer = new MCP_Server(serverInfo.name);

            // Parse serverConfig JSON to extract command and arguments
            if (!string.IsNullOrEmpty(serverInfo.serverConfig))
            {
                try
                {
                    var (Data, McpType) = ParseServerConfig(serverInfo.serverConfig);
                    mcpServer.Data = Data;
                    mcpServer.McpType = McpType;
                }
                catch (Exception ex)
                {
                    // Log error and use defaults
                    System.Diagnostics.Debug.WriteLine($"Failed to parse serverConfig for {serverInfo.name}: {ex.Message}");
                }
            }

            return mcpServer;
        }

        /// <summary>
        /// Parses the serverConfig JSON string to extract MCP configuration
        /// </summary>
        private static (MCPData Data, MCPType McpType) ParseServerConfig(string serverConfigJson)
        {
            string? command = null;
            List<string>? arguments = null;
            Dictionary<string, string?>? env = null;
            string? url = null;
            var mcpType = MCPType.STDIO;

            try
            {
                using var document = JsonDocument.Parse(serverConfigJson);
                var root = document.RootElement;

                if (root.TryGetProperty("mcpServer", out var mcpServerElement))
                {
                    if (mcpServerElement.TryGetProperty("command", out var commandElement))
                        command = commandElement.GetString();

                    if (mcpServerElement.TryGetProperty("args", out var argsElement) && argsElement.ValueKind == JsonValueKind.Array)
                        arguments = [.. argsElement.EnumerateArray()
                                               .Select(arg => arg.GetString()!)
                                               .Where(arg => !string.IsNullOrEmpty(arg))];

                    if (mcpServerElement.TryGetProperty("env", out var envElement) && envElement.ValueKind == JsonValueKind.Object)
                    {
                        env = [];
                        foreach (var property in envElement.EnumerateObject())
                        {
                            env[property.Name] = property.Value.GetString();
                        }
                    }

                    if (mcpServerElement.TryGetProperty("url", out var urlElement) && !string.IsNullOrEmpty(urlElement.GetString()))
                    {
                        mcpType = MCPType.SSE;
                        url = urlElement.GetString();
                    }
                }
            }
            catch (JsonException ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to parse serverConfig JSON: {ex.Message}");
                throw new ArgumentException($"Invalid serverConfig JSON: {ex.Message}", ex);
            }

            return (new MCPData(command, arguments, env, url), mcpType);
        }
    }
}