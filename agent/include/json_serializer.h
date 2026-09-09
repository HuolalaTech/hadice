#ifndef JSON_SERIALIZER_H
#define JSON_SERIALIZER_H

#include <string>
#include <map>

namespace network_agent {

class JsonSerializer {
public:
    static std::string serializeHttpRequest(
        int requestId,
        const std::string& method,
        const std::string& url,
        const std::string& baseUrl,
        const std::map<std::string, std::string>& headers,
        const std::string& body,
        const std::map<std::string, std::string>& params = {}
    );
    
    static std::string serializeHttpResponse(
        int requestId,
        int statusCode,
        const std::map<std::string, std::string>& headers,
        const std::string& body
    );
    
    static std::string serializeHeartbeat();
    
    static std::string escapeString(const std::string& str);
    static std::string mapToJson(const std::map<std::string, std::string>& map);
    
    static int64_t getCurrentTimestamp();

private:
    JsonSerializer() = default;
};

}

#endif