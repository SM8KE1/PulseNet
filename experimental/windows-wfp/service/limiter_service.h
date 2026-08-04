#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <fwpmu.h>
#include <mstcpip.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "..\shared\pulsenet_limiter.h"

struct GuidHash {
    size_t operator()(const GUID& value) const noexcept;
};

struct GuidEqual {
    bool operator()(const GUID& left, const GUID& right) const noexcept;
};

struct LimiterRule {
    GUID id{};
    std::wstring executablePath;
    std::wstring processName;
    uint64_t downloadLimitBps = 0;
    uint64_t uploadLimitBps = 0;
    bool enabled = true;
};

class TokenBucket {
public:
    explicit TokenBucket(uint64_t limitBps = 0);

    void SetLimit(uint64_t limitBps);
    bool Acquire(size_t bytes, const std::atomic_bool& stopping);

private:
    void RefillLocked(std::chrono::steady_clock::time_point now);

    std::mutex mutex_;
    uint64_t limitBps_ = 0;
    double bytesPerSecond_ = 0.0;
    double capacity_ = 0.0;
    double tokens_ = 0.0;
    std::chrono::steady_clock::time_point updatedAt_;
};

struct RuleRuntime {
    explicit RuleRuntime(const LimiterRule& rule);

    void Update(const LimiterRule& rule);

    GUID id{};
    TokenBucket download;
    TokenBucket upload;
};

using RuleRuntimePtr = std::shared_ptr<RuleRuntime>;
using RuntimeMap = std::unordered_map<GUID, RuleRuntimePtr, GuidHash, GuidEqual>;

