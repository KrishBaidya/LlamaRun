using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace LlamaRun
{
    internal class Models
    {
        public static ImmutableDictionary<string, ModelService> models =
            ImmutableDictionary.CreateRange(
                [
                new KeyValuePair<string, ModelService>("Google Gemini",
                    new ModelService("Google Gemini", new Dictionary<string, string>()
                    {
                        ["Gemini 2.0 Flash"] = "gemini-2.0-flash",
                        ["Gemini 2.5 Flash"] = "gemini-2.5-flash-preview-04-17",
                        ["Gemini 2.0 Flash Lite"] = "gemini-2.0-flash-lite",
                    }
                    ))
                ]
            );
    }

    public class ModelService(string Name, Dictionary<string, string> models)
    {
        public string Name { get; set; } = Name;
        public Dictionary<string, string> Models { get; set; } = models;
    }
}
