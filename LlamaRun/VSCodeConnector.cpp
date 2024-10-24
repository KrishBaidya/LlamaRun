#include "pch.h"
#include "VSCodeConnector.h"

std::vector<SOCKET> connectedClients; // Track connected clients
std::mutex clientMutex;               // To avoid race conditions when modifying client list


VSCodeConnector& VSCodeConnector::GetInstance()
{
	static VSCodeConnector instance;
	return instance;
}

void VSCodeConnector::SaveLastActiveWindow() {
	// Get the currently active window before your app becomes active
	HWND currentWindow = GetForegroundWindow();
	if (currentWindow != NULL) {
		previousWindow = currentWindow;
	}
}

bool VSCodeConnector::IsVSCodeActive()
{
	wchar_t windowTitle[256];
	if (previousWindow != NULL) {
		GetWindowText(previousWindow, windowTitle, sizeof(windowTitle));

		std::wstring title(windowTitle);

		if (title.find(L"Visual Studio Code") != std::wstring::npos) {
			return true;
		}

	}
	return false;
}

std::string VSCodeConnector::sanitizeCodeChunk(const std::string& codeChunk) {
	std::string sanitizedChunk = codeChunk;

	// Remove any trailing unwanted characters like )) before the newline
	sanitizedChunk.erase(std::remove_if(sanitizedChunk.begin(), sanitizedChunk.end(),
		[](unsigned char c) { return !std::isprint(c) && c != '\n'; }),
		sanitizedChunk.end());

	return sanitizedChunk;
}

std::string VSCodeConnector::escapeNewlines(const std::string& codeChunk) {
	std::string escapedChunk;
	for (char ch : codeChunk) {
		if (ch == '\n') {
			escapedChunk += "\\n"; // Escape newlines as "\\n" in JSON
		}
		else {
			escapedChunk += ch;
		}
	}
	return escapedChunk;
}

using json = nlohmann::json;

// Function to broadcast data to all connected clients
void VSCodeConnector::broadcastCodeToClients(const std::string& codeChunk) {
	json jsonData;
	if (!codeChunk.empty()) {
		jsonData["codeChunk"] = codeChunk;
	}
	else {
		OutputDebugString(L"Code chunk is empty or invalid.");
		return;
	}

	std::string jsonString = jsonData.dump().c_str();

	std::string response = "HTTP/1.1 200 OK\r\n";
	response += "Content-Type: application/json\r\n";
	response += "Content-Length: " + std::to_string(jsonString.length()) + "\r\n";
	response += "Connection: keep-alive\r\n\r\n";
	response += jsonString;

	std::lock_guard<std::mutex> lock(clientMutex);
	for (auto& clientSocket : connectedClients) {
		int iResult = send(clientSocket, response.c_str(), (int)response.length(), 0);
		if (iResult == SOCKET_ERROR) {
			OutputDebugString(L"Send failed to client: " + WSAGetLastError());
		}
	}
}

bool VSCodeConnector::setupServerSocket(SOCKET& ListenSocket, const char* port) {
	WSADATA wsaData;
	struct addrinfo* result = NULL, hints;

	// Initialize Winsock
	int iResult = WSAStartup(MAKEWORD(2, 2), &wsaData);
	if (iResult != 0) {
		std::cerr << "WSAStartup failed: " << iResult << std::endl;
		return false;
	}

	ZeroMemory(&hints, sizeof(hints));
	hints.ai_family = AF_INET;
	hints.ai_socktype = SOCK_STREAM;
	hints.ai_protocol = IPPROTO_TCP;
	hints.ai_flags = AI_PASSIVE;  // Use for listening socket

	// Resolve the server address and port
	iResult = getaddrinfo(NULL, port, &hints, &result);
	if (iResult != 0) {
		std::cerr << "getaddrinfo failed: " << iResult << std::endl;
		WSACleanup();
		return false;
	}

	// Create a socket for connecting to server
	ListenSocket = socket(result->ai_family, result->ai_socktype, result->ai_protocol);
	if (ListenSocket == INVALID_SOCKET) {
		std::cerr << "Error at socket(): " << WSAGetLastError() << std::endl;
		freeaddrinfo(result);
		WSACleanup();
		return false;
	}

	// Bind the socket
	iResult = bind(ListenSocket, result->ai_addr, (int)result->ai_addrlen);
	if (iResult == SOCKET_ERROR) {
		std::cerr << "Bind failed: " << WSAGetLastError() << std::endl;
		freeaddrinfo(result);
		closesocket(ListenSocket);
		WSACleanup();
		return false;
	}

	freeaddrinfo(result);
	return true;
}

void VSCodeConnector::acceptConnections(SOCKET ListenSocket) {
	while (true) {
		// Listen for incoming connections
		if (listen(ListenSocket, SOMAXCONN) == SOCKET_ERROR) {
			std::cerr << "Listen failed: " << WSAGetLastError() << std::endl;
			closesocket(ListenSocket);
			WSACleanup();
			return;
		}

		// Accept client connections
		SOCKET ClientSocket = accept(ListenSocket, NULL, NULL);
		if (ClientSocket == INVALID_SOCKET) {
			std::cerr << "Accept failed: " << WSAGetLastError() << std::endl;
			closesocket(ListenSocket);
			WSACleanup();
			return;
		}

		{
			std::lock_guard<std::mutex> lock(clientMutex);
			connectedClients.push_back(ClientSocket);  // Add to the list of connected clients
		}

		// Optionally, handle client communication in a separate thread
		std::thread([ClientSocket]() {
			char recvbuf[512];
			int recvbuflen = 512;

			// Receive initial client request
			int iResult = recv(ClientSocket, recvbuf, recvbuflen, 0);
			if (iResult > 0) {
				// Handle client request, respond, etc.
			}

			}).detach();
	}
}

void VSCodeConnector::cleanupSocket(SOCKET ListenSocket) {
	closesocket(ListenSocket);
	WSACleanup();
}