const secretPatterns = [
    [/(--?(?:access-?token|token|serial|password|secret)\s+)(\S+)/gi, "$1<redacted>"],
    [/(https?:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, "$1<redacted>$3"],
    [/\bey[A-Za-z0-9_-]{20,}\b/g, "<redacted-token>"],
    [
        /("(?:accessToken|evalToken|token|serial|password|secret)"\s*:\s*")[^"]+(")/gi,
        "$1<redacted>$2",
    ],
    [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted>"],
    [
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        "<redacted-email>",
    ],
];
export function redact(value, maxLength = 1_000_000) {
    let result = value.slice(0, maxLength);
    for (const [pattern, replacement] of secretPatterns) {
        result = result.replace(pattern, replacement);
    }
    if (value.length > maxLength)
        result += "\n<truncated>";
    return result;
}
//# sourceMappingURL=redaction.js.map