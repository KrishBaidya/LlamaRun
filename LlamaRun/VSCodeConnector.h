#pragma once
#include "pch.h"

#include "VSCodeConnector.h"

class VSCodeConnector
{
public:
	static VSCodeConnector& GetInstance();

	void SaveLastActiveWindow();

	bool IsVSCodeActive();

	std::string sanitizeCodeChunk(const std::string&);

	std::string escapeNewlines(const std::string&);

	bool streamCodeToVSCode(const std::string& codeChunk, SOCKET ConnectSocket);

	bool setupSocket(SOCKET& ConnectSocket);

	void cleanupSocket(SOCKET ConnectSocket);

	bool sendGeneratedCodeToVSCode(const std::string&);

private:
	HWND previousWindow = NULL;

	VSCodeConnector() = default;
	~VSCodeConnector() = default;
};