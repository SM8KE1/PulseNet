#pragma once

#include "ipc_server.h"
#include "proxy_server.h"
#include "wfp_controller.h"

class ServiceCore {
public:
    ServiceCore() = default;
    ~ServiceCore();

    ServiceCore(const ServiceCore&) = delete;
    ServiceCore& operator=(const ServiceCore&) = delete;

    DWORD Start();
    void Stop();
    DWORD ReplaceRules(const std::vector<LimiterRule>& rules);

    uint32_t StatusFlags() const;
    uint32_t ActiveRuleCount() const;

private:
    bool IsDriverRunning() const;

    mutable std::mutex mutex_;
    bool started_ = false;
    std::vector<LimiterRule> rules_;
    ProxyServer proxy_;
    WfpController wfp_;
    std::unique_ptr<IpcServer> ipc_;
};
