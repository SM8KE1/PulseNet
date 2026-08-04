#include "limiter_service.h"

#include <algorithm>
#include <cmath>
#include <cstring>

size_t GuidHash::operator()(const GUID& value) const noexcept
{
    const auto* bytes = reinterpret_cast<const unsigned char*>(&value);
    size_t hash = static_cast<size_t>(1469598103934665603ull);
    for (size_t index = 0; index < sizeof(GUID); ++index) {
        hash ^= bytes[index];
        hash *= static_cast<size_t>(1099511628211ull);
    }
    return hash;
}

bool GuidEqual::operator()(const GUID& left, const GUID& right) const noexcept
{
    return std::memcmp(&left, &right, sizeof(GUID)) == 0;
}

TokenBucket::TokenBucket(uint64_t limitBps)
    : updatedAt_(std::chrono::steady_clock::now())
{
    SetLimit(limitBps);
}

void TokenBucket::SetLimit(uint64_t limitBps)
{
    std::lock_guard lock(mutex_);
    const auto now = std::chrono::steady_clock::now();
    RefillLocked(now);
    limitBps_ = limitBps;
    bytesPerSecond_ = static_cast<double>(limitBps_) / 8.0;
    capacity_ = limitBps_ == 0 ? 0.0 : std::max(256.0, bytesPerSecond_ * 0.20);
    tokens_ = limitBps_ == 0 ? 0.0 : std::min(tokens_, capacity_);
    if (limitBps_ != 0 && tokens_ < 1.0) {
        tokens_ = std::min(capacity_, bytesPerSecond_ * 0.05);
    }
    updatedAt_ = now;
}

void TokenBucket::RefillLocked(std::chrono::steady_clock::time_point now)
{
    if (limitBps_ == 0 || bytesPerSecond_ <= 0.0) {
        updatedAt_ = now;
        return;
    }
    const std::chrono::duration<double> elapsed = now - updatedAt_;
    tokens_ = std::min(capacity_, tokens_ + elapsed.count() * bytesPerSecond_);
    updatedAt_ = now;
}

bool TokenBucket::Acquire(size_t bytes, const std::atomic_bool& stopping)
{
    size_t remaining = bytes;
    while (remaining != 0 && !stopping.load(std::memory_order_relaxed)) {
        std::chrono::milliseconds delay(0);
        {
            std::lock_guard lock(mutex_);
            if (limitBps_ == 0) {
                return true;
            }

            const auto now = std::chrono::steady_clock::now();
            RefillLocked(now);
            const size_t available = static_cast<size_t>(std::floor(tokens_));
            if (available != 0) {
                const size_t consumed = std::min(available, remaining);
                tokens_ -= static_cast<double>(consumed);
                remaining -= consumed;
                continue;
            }

            const double seconds = std::clamp(1.0 / bytesPerSecond_, 0.002, 0.050);
            delay = std::chrono::milliseconds(
                static_cast<int64_t>(std::ceil(seconds * 1000.0)));
        }
        std::this_thread::sleep_for(delay);
    }
    return remaining == 0;
}

RuleRuntime::RuleRuntime(const LimiterRule& rule)
    : id(rule.id), download(rule.downloadLimitBps), upload(rule.uploadLimitBps)
{
}

void RuleRuntime::Update(const LimiterRule& rule)
{
    download.SetLimit(rule.downloadLimitBps);
    upload.SetLimit(rule.uploadLimitBps);
}

