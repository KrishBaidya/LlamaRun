#pragma once
#include "AIService.h"
class OllamaService :
	public AIService
{
public:
	IAsyncAction TextGeneration(std::string model, std::string inputText) override;

	IAsyncOperation<bool> LoadModels() override;

	IAsyncOperation<bool> CheckandLoadOllama();

	bool IsOllamaAvailable();

	std::function<void(const ollama::response&)> OllamaTextGeneration();

	std::vector<std::string> GetModels() override;

	std::string GetServiceName() override {
		return "Ollama";
	}

private:
	std::vector<std::string> models = std::vector<std::string>();
};

