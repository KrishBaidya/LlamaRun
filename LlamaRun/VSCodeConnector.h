#pragma once
#include "pch.h"

class VSCodeConnector
{
public:
	static VSCodeConnector& GetInstance();

	void SaveLastActiveWindow();

	bool IsVSCodeActive() const;

	std::string sanitizeCodeChunk(const std::string&);

	std::string escapeNewlines(const std::string&);

	bool streamCodeToVSCode(const std::string& codeChunk, const SOCKET& ConnectSocket);

	bool setupSocket(SOCKET& ConnectSocket);

	void cleanupSocket(SOCKET ConnectSocket);

private:
	HWND previousWindow = NULL;

	VSCodeConnector() = default;
	~VSCodeConnector() = default;
};