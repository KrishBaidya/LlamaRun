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

	void broadcastCodeToClients(const std::string&);

	bool setupServerSocket(SOCKET&, const char*);

	void VSCodeConnector::acceptConnections(SOCKET ListenSocket);

	void cleanupSocket(SOCKET ConnectSocket);

private:
	HWND previousWindow = NULL;

	VSCodeConnector() = default;
	~VSCodeConnector() = default;
};