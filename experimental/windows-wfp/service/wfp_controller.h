#pragma once

#include "limiter_service.h"

class WfpController {
public:
    WfpController() = default;
    ~WfpController();

    WfpController(const WfpController&) = delete;
    WfpController& operator=(const WfpController&) = delete;

    DWORD Initialize();
    DWORD ApplyRules(
        const std::vector<LimiterRule>& rules,
        DWORD serviceProcessId,
        uint16_t proxyPortV4,
        uint16_t proxyPortV6);
    void Shutdown();

    bool IsReady() const noexcept { return engine_ != nullptr; }

private:
    struct InstalledRuleKeys {
        GUID providerContext{};
        GUID filterV4{};
        GUID filterV6{};
    };

    DWORD AddBaseObjects();
    DWORD AddRule(
        const LimiterRule& rule,
        const FWP_BYTE_BLOB* appId,
        DWORD serviceProcessId,
        uint16_t proxyPortV4,
        uint16_t proxyPortV6,
        InstalledRuleKeys* keys);

    HANDLE engine_ = nullptr;
    std::vector<InstalledRuleKeys> installedRules_;
};

