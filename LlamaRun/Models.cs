using System.Collections.Generic;

namespace LlamaRun
{
    internal class Models
    {
        public static Dictionary<string, ModelService> models = new()
        {
            ["gemini"] = new ModelService("Google Gemini", new Dictionary<string, Model>()
            {
                ["Gemini 2.0 Flash"] = new("gemini-2.0-flash", []),
                ["Gemini 2.5 Flash"] = new("gemini-2.5-flash", []),
                ["Gemini 2.0 Flash Lite"] = new("gemini-2.0-flash-lite", []),
                //["Gemini 2.5 Pro"] = new("gemini-2.5-pro-preview-05-06",[]),
            }),
            ["gpt-4"] = new ModelService("OpenAI", new Dictionary<string, Model>()
            {
#if DEBUG
                ["GPT 4o Mini"] = new("gpt-4o-mini", []),
#endif
                ["GPT 4.1 Mini"] = new("gpt-4.1-mini", []),
                ["GPT 4.1 Nano"] = new("gpt-4.1-nano", []),
            })
        };

        //        public static ImmutableDictionary<string, ModelService> models =
        //            ImmutableDictionary.CreateRange(
        //                [
        //                new KeyValuePair<string, ModelService>("Google Gemini",
        //                    new ModelService("Google Gemini", new Dictionary<string, Model>()
        //                    {
        //                        ["Gemini 2.0 Flash"] = new("gemini-2.0-flash", [] ),
        //                        ["Gemini 2.5 Flash"] = new("gemini-2.5-flash",[]),
        //                        ["Gemini 2.0 Flash Lite"] = new("gemini-2.0-flash-lite",[]),
        //                        //["Gemini 2.5 Pro"] = new("gemini-2.5-pro-preview-05-06",[]),
        //                    }
        //                    )),
        //#if DEBUG
        //                new KeyValuePair<string, ModelService>("OpenAI",
        //                    new ModelService("OpenAI", new Dictionary<string, Model>()
        //                    {
        //                        ["GPT 4o Mini"] = new("gpt-4o-mini", []),
        //                        ["GPT 4.1 Mini"] = new("gpt-4.1-mini",[]),
        //                        ["GPT 4.1 Nano"] = new("gpt-4.1-nano",[]),
        //                    }
        //                    )),
        //#endif
        //            ]
        //            );
    }

    public enum Capabilities
    {
        Text,
        ImageGen,
        Vision,
        VideoVision,
        Reasoning,
        Search,
        MCPTools
    }

    public class ModelService(string Name, Dictionary<string, Model> models)
    {
        public string Name { get; set; } = Name;
        public Dictionary<string, Model> Models { get; set; } = models;
    }

    public class Model(string Name, List<Capabilities> Capabilities)
    {
        public string Name { get; } = Name;
        public List<Capabilities> Capabilities { get; } = Capabilities;
    }
}
