#pragma once
#include "AIService.h"
class CloudLLMService :
	public AIService
{
public:
	IAsyncAction TextGeneration(std::string model, std::string inputText) override;

	IAsyncOperation<bool> LoadModels() override;

	std::vector<std::string> GetModels() override;

	std::string GetServiceName() override {
		return "Cloud";
	}

private:
	// Currently Hardcoded
	std::vector<std::string> models = { "Gemini 2.0 Flash Experimental" };
};

