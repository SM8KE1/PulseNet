#pragma once

#include "limiter_service.h"

class ServiceCore;

class IpcServer {
public:
    explicit IpcServer(ServiceCore& core);
    ~IpcServer();

    IpcServer(const IpcServer&) = delete;
    IpcServer& operator=(const IpcServer&) = delete;

    DWORD Start();
    void Stop();

private:
    void Run();
    void HandleClient(HANDLE pipe);
    DWORD ParseRules(const std::vector<unsigned char>& payload, std::vector<LimiterRule>* rules);
    bool WriteStatus(
        HANDLE pipe,
        const PULSENET_LIMITER_MESSAGE_HEADER& request,
        DWORD result);

    ServiceCore& core_;
    std::atomic_bool stopping_{false};
    std::thread thread_;
};

