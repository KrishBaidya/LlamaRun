using Newtonsoft.Json;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace LlamaRun
{
    public class MCP_Server
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("mcpType")]
        public MCPType McpType { get; set; } = MCPType.STDIO;

        [JsonPropertyName("data")]
        public MCPData Data { get; set; } = new MCPData();

        // Needed by System.Text.Json
        public MCP_Server() { }

        public MCP_Server(string name)
        {
            Name = name;
            McpType = MCPType.STDIO; // Default value
            Data = new MCPData(); // Default value
        }
    }

    [System.Text.Json.Serialization.JsonConverter(typeof(JsonStringEnumConverter))]
    public enum MCPType
    {
        STDIO,
        SSE
    }

    public class MCPData
    {
        [JsonPropertyName("Command")]
        public string? Command { get; }

        [JsonPropertyName("Arguments")]
        public List<string>? Arguments { get; }

        [JsonPropertyName("EnvironmentVariables")]
        public Dictionary<string, string?>? EnvironmentVariables { get; }

        [JsonPropertyName("URL")]
        public string? URL { get; }

        [System.Text.Json.Serialization.JsonConstructor]
        public MCPData(string? command = null,
                       List<string>? arguments = null,
                       Dictionary<string, string?>? environmentVariables = null,
                       string? url = null)
        {
            Command = command;
            Arguments = arguments;
            EnvironmentVariables = environmentVariables;
            URL = url;
        }
    }



    public class MCPServerObjectComparer : IEqualityComparer<MCP_Server>
    {
        public bool Equals(MCP_Server? x, MCP_Server? y)
        {
            if (ReferenceEquals(x, y))
                return true;
            if (x is null || y is null)
                return false;
            return Newtonsoft.Json.JsonConvert.SerializeObject(x) == JsonConvert.SerializeObject(y);
        }

        public int GetHashCode(MCP_Server obj)
        {
            return Newtonsoft.Json.JsonConvert.SerializeObject(obj).GetHashCode();
        }
    }

}