#include "json_serializer.h"

#include <chrono>
#include <sstream>
#include <iomanip>

namespace network_agent {

std::string JsonSerializer::escapeString(const std::string& str) {
    std::string result;
    result.reserve(str.length() * 2);
    
    for (char c : str) {
        switch (c) {
            case '"':  result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\b': result += "\\b"; break;
            case '\f': result += "\\f"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default:
                if (c >= 0 && c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", (unsigned char)c);
                    result += buf;
                } else {
                    result += c;
                }
        }
    }
    
    return result;
}

std::string JsonSerializer::mapToJson(const std::map<std::string, std::string>& map) {
    if (map.empty()) {
        return "{}";
    }
    
    std::string result = "{";
    bool first = true;
    
    for (const auto& pair : map) {
        if (!first) {
            result += ",";
        }
        result += "\"" + escapeString(pair.first) + "\":\"" + escapeString(pair.second) + "\"";
        first = false;
    }
    
    result += "}";
    return result;
}

int64_t JsonSerializer::getCurrentTimestamp() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
}

std::string JsonSerializer::serializeHttpRequest(
    int requestId,
    const std::string& method,
    const std::string& url,
    const std::string& baseUrl,
    const std::map<std::string, std::string>& headers,
    const std::string& body,
    const std::map<std::string, std::string>& params
) {
    std::ostringstream oss;
    
    oss << "{"
        << "\"version\":1,"
        << "\"type\":\"http_record\","
        << "\"timestamp\":" << getCurrentTimestamp() << ","
        << "\"data\":{"
        << "\"extra\":{"
        << "\"id\":" << requestId << ","
        << "\"uid\":\"android\","
        << "\"reqTime\":" << getCurrentTimestamp() << ","
        << "\"respTime\":0"
        << "},"
        << "\"request\":{"
        << "\"method\":\"" << escapeString(method) << "\","
        << "\"url\":\"" << escapeString(url) << "\","
        << "\"baseURL\":\"" << escapeString(baseUrl) << "\","
        << "\"headers\":" << mapToJson(headers) << ","
        << "\"data\":\"" << escapeString(body) << "\","
        << "\"params\":" << mapToJson(params)
        << "},"
        << "\"response\":{"
        << "\"status\":0,"
        << "\"headers\":{},"
        << "\"data\":\"\""
        << "}"
        << "}"
        << "}";
    
    return oss.str();
}

std::string JsonSerializer::serializeHttpResponse(
    int requestId,
    int statusCode,
    const std::map<std::string, std::string>& headers,
    const std::string& body
) {
    std::ostringstream oss;
    
    oss << "{"
        << "\"version\":1,"
        << "\"type\":\"http_record\","
        << "\"timestamp\":" << getCurrentTimestamp() << ","
        << "\"data\":{"
        << "\"extra\":{"
        << "\"id\":" << requestId << ","
        << "\"uid\":\"android\","
        << "\"reqTime\":0,"
        << "\"respTime\":" << getCurrentTimestamp()
        << "},"
        << "\"request\":{},"
        << "\"response\":{"
        << "\"status\":" << statusCode << ","
        << "\"headers\":" << mapToJson(headers) << ","
        << "\"data\":\"" << escapeString(body) << "\""
        << "}"
        << "}"
        << "}";
    
    return oss.str();
}

std::string JsonSerializer::serializeHeartbeat() {
    std::ostringstream oss;
    
    oss << "{"
        << "\"version\":1,"
        << "\"type\":\"heartbeat\","
        << "\"timestamp\":" << getCurrentTimestamp()
        << "}";
    
    return oss.str();
}

}