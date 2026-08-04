#pragma once

#include <windows.h>

#include <string>
#include <vector>

struct WfpApplicationRule {
    std::wstring path;
    std::wstring name;
};

class WfpBlocker {
public:
    ~WfpBlocker();

    DWORD Initialize();
    DWORD ReplaceRules(const std::vector<WfpApplicationRule>& rules);
    void Shutdown();

private:
    HANDLE engine_ = nullptr;
    std::vector<UINT64> filterIds_;
};
