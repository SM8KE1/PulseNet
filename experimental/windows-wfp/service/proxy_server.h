#pragma once

#include "limiter_service.h"

#include <unordered_set>

class ProxyServer {
public:
    ProxyServer() = default;
    ~ProxyServer();

    ProxyServer(const ProxyServer&) = delete;
    ProxyServer& operator=(const ProxyServer&) = delete;

    DWORD Start();
    void Stop();
    void ReplaceRules(const std::vector<LimiterRule>& rules);

    bool IsReady() const noexcept;
    uint16_t PortV4() const noexcept { return portV4_; }
    uint16_t PortV6() const noexcept { return portV6_; }

private:
    DWORD CreateListener(int family, SOCKET* listener, uint16_t* port);
    void AcceptLoop(SOCKET listener);
    void HandleConnection(SOCKET client);
    void Relay(SOCKET source, SOCKET destination, TokenBucket& bucket);
    RuleRuntimePtr FindRuntime(const GUID& id);
    void RegisterSocket(SOCKET socket);
    void UnregisterSocket(SOCKET socket);

    std::atomic_bool stopping_{false};
    bool winsockStarted_ = false;
    SOCKET listenerV4_ = INVALID_SOCKET;
    SOCKET listenerV6_ = INVALID_SOCKET;
    uint16_t portV4_ = 0;
    uint16_t portV6_ = 0;
    std::thread acceptThreadV4_;
    std::thread acceptThreadV6_;

    std::mutex runtimeMutex_;
    RuntimeMap runtimes_;

    std::mutex connectionsMutex_;
    std::unordered_set<SOCKET> activeSockets_;
    std::vector<std::thread> connectionThreads_;
};

