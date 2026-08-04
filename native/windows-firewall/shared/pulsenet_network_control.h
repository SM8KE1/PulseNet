#pragma once

#define PULSENET_NETWORK_PROTOCOL_VERSION 1u
#define PULSENET_NETWORK_SERVICE_NAME L"PulseNetNetworkControl"
#define PULSENET_NETWORK_PIPE_NAME L"\\\\.\\pipe\\PulseNetNetworkControl"
#define PULSENET_NETWORK_IPC_MAGIC 0x504E4E43u
#define PULSENET_NETWORK_MAX_MESSAGE_SIZE (1024u * 1024u)
#define PULSENET_NETWORK_MAX_PATH_CHARS 32767u

typedef enum _PULSENET_NETWORK_COMMAND {
    PulseNetNetworkCommandHandshake = 1,
    PulseNetNetworkCommandReplaceRules = 3,
    PulseNetNetworkCommandGetUsage = 4
} PULSENET_NETWORK_COMMAND;

typedef enum _PULSENET_NETWORK_STATUS_FLAGS {
    PulseNetNetworkStatusServiceReady = 0x00000001,
    PulseNetNetworkStatusFirewallReady = 0x00000002
} PULSENET_NETWORK_STATUS_FLAGS;

#pragma pack(push, 1)

typedef struct _PULSENET_NETWORK_MESSAGE_HEADER {
    UINT32 magic;
    UINT16 protocolVersion;
    UINT16 command;
    UINT32 payloadSize;
    UINT64 requestId;
} PULSENET_NETWORK_MESSAGE_HEADER;

typedef struct _PULSENET_NETWORK_STATUS_RESPONSE {
    PULSENET_NETWORK_MESSAGE_HEADER header;
    UINT32 statusFlags;
    UINT32 win32Error;
    UINT32 activeRuleCount;
    UINT32 reserved;
} PULSENET_NETWORK_STATUS_RESPONSE;

typedef struct _PULSENET_NETWORK_RULES_HEADER {
    UINT32 ruleCount;
    UINT32 reserved;
} PULSENET_NETWORK_RULES_HEADER;

// Limits remain in the shared wire format for cross-platform rule compatibility.
typedef struct _PULSENET_NETWORK_RULE_WIRE {
    GUID ruleId;
    UINT64 downloadLimitBps;
    UINT64 uploadLimitBps;
    UINT32 enabled;
    UINT32 pathChars;
    UINT32 nameChars;
    UINT32 reserved;
} PULSENET_NETWORK_RULE_WIRE;

typedef struct _PULSENET_NETWORK_USAGE_RESPONSE_HEADER {
    PULSENET_NETWORK_MESSAGE_HEADER header;
    UINT32 statusFlags;
    UINT32 win32Error;
    UINT32 entryCount;
    UINT32 reserved;
} PULSENET_NETWORK_USAGE_RESPONSE_HEADER;

typedef struct _PULSENET_NETWORK_USAGE_ENTRY_WIRE {
    UINT64 downloadBytes;
    UINT32 pathChars;
    UINT32 nameChars;
    UINT32 reserved;
} PULSENET_NETWORK_USAGE_ENTRY_WIRE;

#pragma pack(pop)
