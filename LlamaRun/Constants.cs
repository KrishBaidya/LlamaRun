namespace LlamaRun
{
    public static class Constants
    {
        /// <summary>
        /// Base URL for Llama Run Server API endpoints. Points to localhost in debug builds.
        /// Change localhost ports as needed
        /// </summary>
        public const string BaseServerUrl =
#if DEBUG
    "https://llamarun.krishbaidya.me";
#else
        "http://localhost:3000";
#endif

        /// <summary>
        /// Base URL for MCP Directory API endpoints. Points to localhost in debug builds.
        /// Change localhost ports as needed
        /// </summary>
        public const string BaseMCPDirectoryUrl =
#if DEBUG
    "http://localhost:3001";
#else
    "https://mcp.krishbaidya.me";
#endif

        /// <summary>
        /// Add ServerDebounceTime to wait before sending another request to server.
        /// </summary>
        public const int ServerDebounceTime = 300;
    }
}