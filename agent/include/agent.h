#ifndef NETWORK_AGENT_H
#define NETWORK_AGENT_H

#include <jni.h>
#include <jvmti.h>
#include <string>
#include <mutex>
#include <vector>

namespace network_agent {

class Agent {
public:
    static Agent* getInstance();

    bool initialize(JavaVM* vm, char* options);
    void shutdown();
    void handleServerMessage(const std::string& message);

    JNIEnv* getJniEnv() const;
    jvmtiEnv* getJvmtiEnv() const { return jvmti_env_; }
    jclass getHelperClass() const { return helper_class_; }

private:
    Agent() = default;
    ~Agent() = default;

    Agent(const Agent&) = delete;
    Agent& operator=(const Agent&) = delete;

    bool setupJvmtiCapabilities();
    bool setupEventCallbacks();
    bool loadHelperDex(JNIEnv* env);
    bool registerHelperNatives(JNIEnv* env);
    void hookExistingNetworkClients(JNIEnv* env);
    void hookClassIfSupported(JNIEnv* env, jclass klass);
    void setupOkHttpBreakpoint(JNIEnv* env, jclass okHttpClass);
    void setupCronetBreakpoint(JNIEnv* env, jclass cronetClass);
    void setupGnetCronetBreakpoint(JNIEnv* env, jclass cronetClass);
    void setupCronetBuilderBreakpoints(JNIEnv* env, jclass builderClass);
    void setupGnetCronetBuilderBreakpoints(JNIEnv* env, jclass builderClass);
    void setupCronetReadBreakpoint(JNIEnv* env, jclass requestClass);
    bool hookCronetMethodByName(JNIEnv* env, jclass klass, const char* methodName,
                                const char* parameterPrefix, std::vector<jmethodID>& storage,
                                const char* description);
    bool hookCronetMethodBySignature(JNIEnv* env, jclass klass, const char* methodName,
                                     const char* signature, std::vector<jmethodID>& storage,
                                     const char* description);
    bool registerBreakpoint(jmethodID method, const char* description);
    bool isKnownBreakpoint(jmethodID method) const;
    bool isCronetBuilderMethod(jmethodID method) const;
    bool isGnetCronetBuilderMethod(jmethodID method) const;
    bool isCronetReadMethod(jmethodID method) const;

    JavaVM* java_vm_ = nullptr;
    jvmtiEnv* jvmti_env_ = nullptr;
    int target_port_ = 6200;
    std::mutex mutex_;
    bool initialized_ = false;
    bool can_force_early_return_ = false;
    jclass helper_class_ = nullptr;
    jmethodID inject_method_ = nullptr;
    jmethodID wrap_cronet_callback_method_ = nullptr;
    jmethodID wrap_gnet_cronet_callback_method_ = nullptr;
    jmethodID link_cronet_builder_method_ = nullptr;
    jmethodID record_cronet_http_method_ = nullptr;
    jmethodID record_cronet_header_method_ = nullptr;
    jmethodID wrap_cronet_upload_provider_method_ = nullptr;
    jmethodID record_cronet_read_start_method_ = nullptr;
    jmethodID create_cronet_mock_request_method_ = nullptr;
    jmethodID link_gnet_cronet_builder_method_ = nullptr;
    jmethodID record_gnet_cronet_http_method_ = nullptr;
    jmethodID record_gnet_cronet_header_method_ = nullptr;
    jmethodID create_gnet_cronet_mock_request_method_ = nullptr;
    jmethodID update_mock_config_method_ = nullptr;
    std::vector<jmethodID> okhttp_methods_;
    std::vector<jmethodID> cronet_methods_;
    std::vector<jmethodID> gnet_cronet_methods_;
    std::vector<jmethodID> cronet_builder_set_method_methods_;
    std::vector<jmethodID> cronet_builder_add_header_methods_;
    std::vector<jmethodID> cronet_builder_set_upload_methods_;
    std::vector<jmethodID> cronet_builder_build_methods_;
    std::vector<jmethodID> gnet_cronet_builder_set_method_methods_;
    std::vector<jmethodID> gnet_cronet_builder_add_header_methods_;
    std::vector<jmethodID> gnet_cronet_builder_build_methods_;
    std::vector<jmethodID> cronet_read_methods_;
    std::string dex_path_;
};

}

#endif
