using System.Collections.Generic;

namespace LlamaRun.MCPServers
{
    public class MCPServerResponse
    {
        public List<MCPServerInfo>? Servers { get; set; }
        public string? NextCursor { get; set; }
    }

    public class MCPServerInfo
    {
        public string? id { get; set; }
        public string? name { get; set; }
        public string? description { get; set; }
        public string? submittedBy { get; set; }
        public string? longDescription { get; set; }
        public string? category { get; set; }
        public string? serverConfig { get; set; }
        public bool? verified { get; set; }
        public string[]? tags { get; set; }
        public string? author { get; set; }
        public string? email { get; set; }
        public bool? requiresAuth { get; set; }
        public string? documentationUrl { get; set; }
        public string? repositoryUrl { get; set; }
        public string[]? features { get; set; }
        public bool? isOpenSource { get; set; }
    }
}
