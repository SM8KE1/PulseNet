#pragma once

#define PULSENET_LIMITER_PROTOCOL_VERSION 1u
#define PULSENET_LIMITER_SERVICE_NAME L"PulseNetLimiter"
#define PULSENET_LIMITER_PIPE_NAME L"\\\\.\\pipe\\PulseNetLimiter"
#define PULSENET_LIMITER_IPC_MAGIC 0x504E4C4Du
#define PULSENET_LIMITER_MAX_MESSAGE_SIZE (1024u * 1024u)
#define PULSENET_LIMITER_MAX_PATH_CHARS 32767u
#define PULSENET_LIMITER_MIN_BPS 1024ull
#define PULSENET_LIMITER_MAX_BPS 10000000000ull

typedef enum _PULSENET_LIMITER_COMMAND {
    PulseNetLimiterCommandHandshake = 1,
    PulseNetLimiterCommandGetRules = 2,
    PulseNetLimiterCommandReplaceRules = 3,
    PulseNetLimiterCommandRemoveRule = 4
} PULSENET_LIMITER_COMMAND;

typedef enum _PULSENET_LIMITER_STATUS_FLAGS {
    PulseNetLimiterStatusServiceReady = 0x00000001,
    PulseNetLimiterStatusDriverLoaded = 0x00000002,
    PulseNetLimiterStatusBfeReady = 0x00000004,
    PulseNetLimiterStatusProxyReady = 0x00000008
} PULSENET_LIMITER_STATUS_FLAGS;

#pragma pack(push, 1)

typedef struct _PULSENET_LIMITER_MESSAGE_HEADER {
    UINT32 magic;
    UINT16 protocolVersion;
    UINT16 command;
    UINT32 payloadSize;
    UINT64 requestId;
} PULSENET_LIMITER_MESSAGE_HEADER;

typedef struct _PULSENET_LIMITER_STATUS_RESPONSE {
    PULSENET_LIMITER_MESSAGE_HEADER header;
    UINT32 statusFlags;
    UINT32 win32Error;
    UINT32 activeRuleCount;
    UINT32 reserved;
} PULSENET_LIMITER_STATUS_RESPONSE;

typedef struct _PULSENET_LIMITER_RULES_HEADER {
    UINT32 ruleCount;
    UINT32 reserved;
} PULSENET_LIMITER_RULES_HEADER;

// Followed by pathChars UTF-16 code units and then nameChars UTF-16 code units.
typedef struct _PULSENET_LIMITER_RULE_WIRE {
    GUID ruleId;
    UINT64 downloadLimitBps;
    UINT64 uploadLimitBps;
    UINT32 enabled;
    UINT32 pathChars;
    UINT32 nameChars;
    UINT32 reserved;
} PULSENET_LIMITER_RULE_WIRE;

#pragma pack(pop)

// Stable identifiers shared by the BFE controller and the callout driver.
static const GUID PULSENET_WFP_PROVIDER_KEY =
    {0x4f60d452, 0x631c, 0x4c74, {0x9a, 0x2e, 0x9e, 0x0d, 0x5e, 0xa7, 0x34, 0xb1}};
static const GUID PULSENET_WFP_SUBLAYER_KEY =
    {0x2d698ee5, 0x3be6, 0x4fe1, {0xb7, 0x73, 0x27, 0x74, 0x59, 0x9e, 0xa6, 0x22}};
static const GUID PULSENET_WFP_CALLOUT_V4_KEY =
    {0xb856337c, 0x93cf, 0x41d9, {0xac, 0x9f, 0x85, 0xec, 0xf3, 0x8a, 0x2a, 0x0d}};
static const GUID PULSENET_WFP_CALLOUT_V6_KEY =
    {0x27e77da4, 0x1196, 0x414c, {0xa5, 0xd5, 0x22, 0xc6, 0xb0, 0x2d, 0xd8, 0x68}};

typedef struct _PULSENET_WFP_PROVIDER_CONTEXT {
    UINT32 version;
    UINT32 size;
    UINT64 serviceProcessId;
    UINT16 proxyPortV4;
    UINT16 proxyPortV6;
    UINT32 reserved;
    GUID ruleId;
    UINT64 downloadLimitBps;
    UINT64 uploadLimitBps;
} PULSENET_WFP_PROVIDER_CONTEXT;

// SOCKADDR_STORAGE is copied as opaque bytes to keep the user/kernel ABI fixed.
typedef struct _PULSENET_WFP_REDIRECT_CONTEXT {
    UINT32 version;
    UINT32 size;
    GUID ruleId;
    UCHAR originalRemote[128];
    UCHAR originalLocal[128];
} PULSENET_WFP_REDIRECT_CONTEXT;
