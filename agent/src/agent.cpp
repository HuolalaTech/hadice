#include "agent.h"
#include "jvmti_utils.h"
#include "socket_client.h"
#include "helper_dex.h"

#include <android/log.h>
#include <cstring>
#include <unistd.h>
#include <cstdio>
#include <sys/stat.h>
#include <algorithm>

#define LOG_TAG "NetworkAgent"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

// JVMTI reports standard JVM classfile access flags, but the Android NDK's
// jvmti.h does not export the JVM_ACC_* symbolic names.
constexpr jint kMethodAccNative = 0x0100;
constexpr jint kMethodAccAbstract = 0x0400;

namespace network_agent {

// Helper to log JNI exception details
static void logJniException(JNIEnv* env, const char* context) {
    if (!env->ExceptionCheck()) return;
    jthrowable exc = env->ExceptionOccurred();
    env->ExceptionClear();
    jclass excClass = env->GetObjectClass(exc);
    jmethodID getMessage = env->GetMethodID(excClass, "toString", "()Ljava/lang/String;");
    jstring msg = (jstring)env->CallObjectMethod(exc, getMessage);
    if (msg) {
        const char* msgStr = env->GetStringUTFChars(msg, nullptr);
        LOGE("%s exception: %s", context, msgStr);
        env->ReleaseStringUTFChars(msg, msgStr);
        env->DeleteLocalRef(msg);
    } else {
        LOGE("%s: exception occurred (no message)", context);
    }
    env->DeleteLocalRef(exc);
}

// JNI native: forwards message to C++ SocketClient
static void JNICALL nativeSendMessage(JNIEnv* env, jclass, jstring jmessage) {
    if (!jmessage) return;
    const char* msg = env->GetStringUTFChars(jmessage, nullptr);
    if (msg) {
        SocketClient::getInstance()->sendMessage(msg);
        env->ReleaseStringUTFChars(jmessage, msg);
    }
}

Agent* Agent::getInstance() {
    static Agent instance;
    return &instance;
}

JNIEnv* Agent::getJniEnv() const {
    JNIEnv* env = nullptr;
    if (java_vm_) {
        int status = java_vm_->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
        if (status == JNI_EDETACHED) {
            JavaVMAttachArgs args;
            args.version = JNI_VERSION_1_6;
            args.name = const_cast<char*>("NetworkAgentThread");
            args.group = nullptr;
            java_vm_->AttachCurrentThread(reinterpret_cast<void**>(&env), &args);
        }
    }
    return env;
}

bool Agent::initialize(JavaVM* vm, char* options) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (initialized_) return true;

    java_vm_ = vm;

    jint result = vm->GetEnv(reinterpret_cast<void**>(&jvmti_env_), JVMTI_VERSION_1_2);
    if (result != JNI_OK) {
        LOGE("Failed to get JVMTI environment");
        return false;
    }

    LOGI("JVMTI environment obtained successfully");

    if (!setupJvmtiCapabilities()) {
        LOGE("Failed to setup JVMTI capabilities");
        return false;
    }

    if (!setupEventCallbacks()) {
        LOGE("Failed to setup event callbacks");
        return false;
    }

    // Parse port
    if (options && strlen(options) > 0) {
        target_port_ = atoi(options);
        if (target_port_ <= 0) target_port_ = 6200;
    }

    SocketClient::getInstance()->setPort(target_port_);
    SocketClient::getInstance()->setMessageHandler([](const std::string& message) {
        Agent::getInstance()->handleServerMessage(message);
    });

    // 启动后台连接+发送线程：连接维护异步进行，不阻塞 am attach-agent 返回
    // 断连期间消息入队列缓冲，连上后自动补发，不漏请求
    SocketClient::getInstance()->startBackgroundThreads();

    initialized_ = true;

    // Load helper DEX + hook supported HTTP clients（不依赖 TCP 连接，可独立完成）
    JNIEnv* env = getJniEnv();
    if (env) {
        if (loadHelperDex(env) && registerHelperNatives(env)) {
            LOGI("Helper class loaded and natives registered");
            jmethodID enableWebViewDebugging = env->GetStaticMethodID(
                helper_class_, "enableWebViewDebugging", "()V");
            if (enableWebViewDebugging) {
                env->CallStaticVoidMethod(helper_class_, enableWebViewDebugging);
                if (env->ExceptionCheck()) {
                    logJniException(env, "enableWebViewDebugging");
                }
            } else {
                env->ExceptionClear();
                LOGE("Cannot find NetworkHookHelper.enableWebViewDebugging");
            }
            hookExistingNetworkClients(env);
        }
    }

    return true;
}

void Agent::hookExistingNetworkClients(JNIEnv* env) {
    // env->FindClass uses the bootstrap classloader, so scan all loaded app classes.
    jint classCount = 0;
    jclass* classes = nullptr;
    jvmtiError err = jvmti_env_->GetLoadedClasses(&classCount, &classes);

    if (err != JVMTI_ERROR_NONE || classes == nullptr) {
        LOGE("GetLoadedClasses failed: %d", err);
        return;
    }

    LOGI("Scanning %d loaded classes for OkHttp and Cronet", classCount);

    for (int i = 0; i < classCount; i++) {
        hookClassIfSupported(env, classes[i]);
        env->DeleteLocalRef(classes[i]);
    }

    jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(classes));
}

void Agent::hookClassIfSupported(JNIEnv* env, jclass klass) {
    if (!helper_class_ || !klass) return;

    char* signature = nullptr;
    jvmtiError signatureErr = jvmti_env_->GetClassSignature(klass, &signature, nullptr);
    if (signatureErr != JVMTI_ERROR_NONE || !signature) return;

    if (strcmp(signature, "Lokhttp3/OkHttpClient;") == 0) {
        setupOkHttpBreakpoint(env, klass);
    } else if (strstr(signature, "Lgnet/android/org/chromium/net/") == signature
               && strstr(signature, "Builder") != nullptr) {
        setupGnetCronetBuilderBreakpoints(env, klass);
    } else if (strstr(signature, "Lgnet/android/org/chromium/net/") == signature
               && strstr(signature, "Cronet") != nullptr) {
        setupGnetCronetBreakpoint(env, klass);
    } else if (strstr(signature, "Lorg/chromium/net/") == signature
               && strstr(signature, "Cronet") != nullptr) {
        // CronetEngine is abstract. The concrete implementation is normally named
        // Cronet* and is what owns the executable newUrlRequestBuilder() method.
        setupCronetBreakpoint(env, klass);
    } else if (strstr(signature, "Lorg/chromium/net/") == signature
               && strstr(signature, "Builder") != nullptr) {
        setupCronetBuilderBreakpoints(env, klass);
    } else if (strstr(signature, "Lorg/chromium/net/") == signature
               && strstr(signature, "UrlRequest") != nullptr
               && strstr(signature, "$") == nullptr) {
        setupCronetReadBreakpoint(env, klass);
    }

    jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(signature));
}

void Agent::setupOkHttpBreakpoint(JNIEnv* env, jclass okHttpClass) {
    // Cache the ensureInterceptorInjected method
    inject_method_ = env->GetStaticMethodID(helper_class_, "ensureInterceptorInjected", "(Ljava/lang/Object;)V");
    if (!inject_method_) {
        LOGE("Cannot find NetworkHookHelper.ensureInterceptorInjected method");
        env->ExceptionClear();
        return;
    }

    // Find OkHttpClient.newCall(Request) method
    // GetMethodID only needs the signature string, doesn't need FindClass for parameter types
    jmethodID method = env->GetMethodID(okHttpClass, "newCall", "(Lokhttp3/Request;)Lokhttp3/Call;");
    if (!method) {
        LOGE("Cannot find OkHttpClient.newCall() method");
        env->ExceptionClear();
        return;
    }

    if (registerBreakpoint(method, "OkHttpClient.newCall()")) {
        okhttp_methods_.push_back(method);
    }
}

void Agent::setupCronetBreakpoint(JNIEnv* env, jclass cronetClass) {
    if (!wrap_cronet_callback_method_) {
        wrap_cronet_callback_method_ = env->GetStaticMethodID(
            helper_class_, "wrapCronetCallback", "(Ljava/lang/String;Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
        if (!wrap_cronet_callback_method_) {
            LOGE("Cannot find NetworkHookHelper.wrapCronetCallback");
            env->ExceptionClear();
            return;
        }
    }

    jmethodID method = env->GetMethodID(
        cronetClass,
        "newUrlRequestBuilder",
        "(Ljava/lang/String;Lorg/chromium/net/UrlRequest$Callback;Ljava/util/concurrent/Executor;)Lorg/chromium/net/UrlRequest$Builder;");
    if (!method) {
        env->ExceptionClear();
        return;
    }

    jint modifiers = 0;
    if (jvmti_env_->GetMethodModifiers(method, &modifiers) != JVMTI_ERROR_NONE
        || (modifiers & kMethodAccAbstract) != 0 || (modifiers & kMethodAccNative) != 0) {
        return;
    }

    if (registerBreakpoint(method, "CronetEngine.newUrlRequestBuilder()")) {
        cronet_methods_.push_back(method);
    }
}

void Agent::setupGnetCronetBreakpoint(JNIEnv* env, jclass cronetClass) {
    if (!wrap_gnet_cronet_callback_method_) {
        wrap_gnet_cronet_callback_method_ = env->GetStaticMethodID(
            helper_class_, "wrapGnetCronetCallback", "(Ljava/lang/String;Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
        if (!wrap_gnet_cronet_callback_method_) { env->ExceptionClear(); return; }
    }
    jmethodID method = env->GetMethodID(
        cronetClass, "newUrlRequestBuilder",
        "(Ljava/lang/String;Lgnet/android/org/chromium/net/UrlRequest$Callback;Ljava/util/concurrent/Executor;)Lgnet/android/org/chromium/net/UrlRequest$Builder;");
    if (!method) { env->ExceptionClear(); return; }
    jint modifiers = 0;
    if (jvmti_env_->GetMethodModifiers(method, &modifiers) != JVMTI_ERROR_NONE
        || (modifiers & kMethodAccAbstract) != 0 || (modifiers & kMethodAccNative) != 0) return;
    if (registerBreakpoint(method, "gnet CronetEngine.newUrlRequestBuilder()")) gnet_cronet_methods_.push_back(method);
}

bool Agent::hookCronetMethodByName(JNIEnv* env, jclass klass, const char* methodName,
                                     const char* parameterPrefix, std::vector<jmethodID>& storage,
                                     const char* description) {
    jint methodCount = 0;
    jmethodID* methods = nullptr;
    jvmtiError err = jvmti_env_->GetClassMethods(klass, &methodCount, &methods);
    if (err != JVMTI_ERROR_NONE || methods == nullptr) {
        return false;
    }

    bool hooked = false;
    size_t prefixLen = strlen(parameterPrefix);

    for (jint i = 0; i < methodCount; i++) {
        jmethodID method = methods[i];
        if (isKnownBreakpoint(method)) continue;

        char* name = nullptr;
        char* signature = nullptr;
        if (jvmti_env_->GetMethodName(method, &name, &signature, nullptr) != JVMTI_ERROR_NONE
            || !name || !signature) {
            if (name) jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(name));
            if (signature) jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(signature));
            continue;
        }

        if (strcmp(name, methodName) == 0
            && strncmp(signature, parameterPrefix, prefixLen) == 0) {
            jint modifiers = 0;
            if (jvmti_env_->GetMethodModifiers(method, &modifiers) == JVMTI_ERROR_NONE
                && (modifiers & kMethodAccAbstract) == 0
                && (modifiers & kMethodAccNative) == 0
                && registerBreakpoint(method, description)) {
                storage.push_back(method);
                hooked = true;
            }
        }

        jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(name));
        jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(signature));
    }

    jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(methods));
    return hooked;
}

bool Agent::hookCronetMethodBySignature(JNIEnv* env, jclass klass, const char* methodName,
                                        const char* expectedSignature, std::vector<jmethodID>& storage,
                                        const char* description) {
    jint methodCount = 0;
    jmethodID* methods = nullptr;
    jvmtiError err = jvmti_env_->GetClassMethods(klass, &methodCount, &methods);
    if (err != JVMTI_ERROR_NONE || methods == nullptr) return false;

    bool hooked = false;
    for (jint i = 0; i < methodCount; i++) {
        jmethodID method = methods[i];
        if (isKnownBreakpoint(method)) continue;
        char* name = nullptr;
        char* signature = nullptr;
        if (jvmti_env_->GetMethodName(method, &name, &signature, nullptr) == JVMTI_ERROR_NONE
            && name && signature && strcmp(name, methodName) == 0
            && strcmp(signature, expectedSignature) == 0) {
            jint modifiers = 0;
            if (jvmti_env_->GetMethodModifiers(method, &modifiers) == JVMTI_ERROR_NONE
                && (modifiers & kMethodAccAbstract) == 0
                && (modifiers & kMethodAccNative) == 0
                && registerBreakpoint(method, description)) {
                storage.push_back(method);
                hooked = true;
            }
        }
        if (name) jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(name));
        if (signature) jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(signature));
    }
    jvmti_env_->Deallocate(reinterpret_cast<unsigned char*>(methods));
    return hooked;
}

void Agent::setupCronetBuilderBreakpoints(JNIEnv* env, jclass builderClass) {
    if (!link_cronet_builder_method_) {
        link_cronet_builder_method_ = env->GetStaticMethodID(
            helper_class_, "linkCronetBuilder", "(Ljava/lang/Object;)V");
        record_cronet_http_method_ = env->GetStaticMethodID(
            helper_class_, "recordCronetHttpMethod", "(Ljava/lang/Object;Ljava/lang/String;)V");
        record_cronet_header_method_ = env->GetStaticMethodID(
            helper_class_, "recordCronetHeader", "(Ljava/lang/Object;Ljava/lang/String;Ljava/lang/String;)V");
        wrap_cronet_upload_provider_method_ = env->GetStaticMethodID(
            helper_class_, "wrapCronetUploadProvider",
            "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
        create_cronet_mock_request_method_ = env->GetStaticMethodID(
            helper_class_, "createCronetMockRequest", "(Ljava/lang/Object;)Ljava/lang/Object;");
        if (!link_cronet_builder_method_ || !record_cronet_http_method_
            || !record_cronet_header_method_ || !wrap_cronet_upload_provider_method_
            || !create_cronet_mock_request_method_) {
            LOGE("Cannot find Cronet builder helper methods");
            env->ExceptionClear();
            return;
        }
    }

    hookCronetMethodByName(env, builderClass, "setHttpMethod", "(Ljava/lang/String;)",
                           cronet_builder_set_method_methods_, "Cronet.Builder.setHttpMethod()");
    hookCronetMethodByName(env, builderClass, "addHeader", "(Ljava/lang/String;Ljava/lang/String;)",
                           cronet_builder_add_header_methods_, "Cronet.Builder.addHeader()");
    hookCronetMethodByName(env, builderClass, "setUploadDataProvider",
                           "(Lorg/chromium/net/UploadDataProvider;Ljava/util/concurrent/Executor;)",
                           cronet_builder_set_upload_methods_, "Cronet.Builder.setUploadDataProvider()");
    // Only a build() returning UrlRequest can safely receive our UrlRequest
    // subclass through ForceEarlyReturnObject. Experimental covariant builders
    // remain capture-only instead of silently falling through to real network.
    hookCronetMethodBySignature(env, builderClass, "build", "()Lorg/chromium/net/UrlRequest;",
                                cronet_builder_build_methods_, "Cronet.Builder.build()");
}

void Agent::setupGnetCronetBuilderBreakpoints(JNIEnv* env, jclass builderClass) {
    if (!link_gnet_cronet_builder_method_) {
        link_gnet_cronet_builder_method_ = env->GetStaticMethodID(
            helper_class_, "linkGnetCronetBuilder", "(Ljava/lang/Object;)V");
        record_gnet_cronet_http_method_ = env->GetStaticMethodID(
            helper_class_, "recordGnetCronetHttpMethod", "(Ljava/lang/Object;Ljava/lang/String;)V");
        record_gnet_cronet_header_method_ = env->GetStaticMethodID(
            helper_class_, "recordGnetCronetHeader", "(Ljava/lang/Object;Ljava/lang/String;Ljava/lang/String;)V");
        create_gnet_cronet_mock_request_method_ = env->GetStaticMethodID(
            helper_class_, "createGnetCronetMockRequest", "(Ljava/lang/Object;)Ljava/lang/Object;");
        if (!link_gnet_cronet_builder_method_ || !record_gnet_cronet_http_method_
            || !record_gnet_cronet_header_method_ || !create_gnet_cronet_mock_request_method_) {
            LOGE("Cannot find gnet Cronet builder helper methods");
            env->ExceptionClear();
            return;
        }
    }

    hookCronetMethodByName(env, builderClass, "setHttpMethod", "(Ljava/lang/String;)",
                           gnet_cronet_builder_set_method_methods_, "gnet Cronet.Builder.setHttpMethod()");
    hookCronetMethodByName(env, builderClass, "addHeader", "(Ljava/lang/String;Ljava/lang/String;)",
                           gnet_cronet_builder_add_header_methods_, "gnet Cronet.Builder.addHeader()");
    // The gnet implementation invokes its covariant ExperimentalUrlRequest
    // overload directly. Our mock is also an ExperimentalUrlRequest, making
    // ForceEarlyReturnObject type-safe for both overloads.
    hookCronetMethodBySignature(env, builderClass, "build",
                                "()Lgnet/android/org/chromium/net/UrlRequest;",
                                gnet_cronet_builder_build_methods_, "gnet Cronet.Builder.build()");
    hookCronetMethodBySignature(env, builderClass, "build",
                                "()Lgnet/android/org/chromium/net/ExperimentalUrlRequest;",
                                gnet_cronet_builder_build_methods_,
                                "gnet ExperimentalUrlRequest.Builder.build()");

}

void Agent::setupCronetReadBreakpoint(JNIEnv* env, jclass requestClass) {
    if (!record_cronet_read_start_method_) {
        record_cronet_read_start_method_ = env->GetStaticMethodID(
            helper_class_, "recordCronetReadStart", "(Ljava/lang/Object;Ljava/lang/Object;)V");
        if (!record_cronet_read_start_method_) {
            LOGE("Cannot find NetworkHookHelper.recordCronetReadStart");
            env->ExceptionClear();
            return;
        }
    }

    hookCronetMethodByName(env, requestClass, "read", "(Ljava/nio/ByteBuffer;)",
                           cronet_read_methods_, "Cronet.UrlRequest.read()");
}

bool Agent::registerBreakpoint(jmethodID method, const char* description) {
    if (!method || isKnownBreakpoint(method)) return false;

    jvmtiError err = jvmti_env_->SetBreakpoint(method, 0);
    if (err != JVMTI_ERROR_NONE) {
        LOGE("SetBreakpoint failed for %s: %d", description, err);
        return false;
    }

    err = jvmti_env_->SetEventNotificationMode(JVMTI_ENABLE, JVMTI_EVENT_BREAKPOINT, nullptr);
    if (err != JVMTI_ERROR_NONE) {
        jvmti_env_->ClearBreakpoint(method, 0);
        LOGE("Failed to enable breakpoint events: %d", err);
        return false;
    }

    LOGI("Breakpoint set on %s", description);
    return true;
}

bool Agent::isKnownBreakpoint(jmethodID method) const {
    return std::find(okhttp_methods_.begin(), okhttp_methods_.end(), method) != okhttp_methods_.end()
        || std::find(cronet_methods_.begin(), cronet_methods_.end(), method) != cronet_methods_.end()
        || std::find(gnet_cronet_methods_.begin(), gnet_cronet_methods_.end(), method) != gnet_cronet_methods_.end()
        || std::find(cronet_builder_set_method_methods_.begin(), cronet_builder_set_method_methods_.end(), method)
            != cronet_builder_set_method_methods_.end()
        || std::find(cronet_builder_add_header_methods_.begin(), cronet_builder_add_header_methods_.end(), method)
            != cronet_builder_add_header_methods_.end()
        || std::find(cronet_builder_set_upload_methods_.begin(), cronet_builder_set_upload_methods_.end(), method)
            != cronet_builder_set_upload_methods_.end()
        || std::find(cronet_builder_build_methods_.begin(), cronet_builder_build_methods_.end(), method)
            != cronet_builder_build_methods_.end()
        || std::find(gnet_cronet_builder_set_method_methods_.begin(), gnet_cronet_builder_set_method_methods_.end(), method)
            != gnet_cronet_builder_set_method_methods_.end()
        || std::find(gnet_cronet_builder_add_header_methods_.begin(), gnet_cronet_builder_add_header_methods_.end(), method)
            != gnet_cronet_builder_add_header_methods_.end()
        || std::find(gnet_cronet_builder_build_methods_.begin(), gnet_cronet_builder_build_methods_.end(), method)
            != gnet_cronet_builder_build_methods_.end()
        || std::find(cronet_read_methods_.begin(), cronet_read_methods_.end(), method) != cronet_read_methods_.end();
}

bool Agent::isCronetBuilderMethod(jmethodID method) const {
    return std::find(cronet_builder_set_method_methods_.begin(), cronet_builder_set_method_methods_.end(), method)
            != cronet_builder_set_method_methods_.end()
        || std::find(cronet_builder_add_header_methods_.begin(), cronet_builder_add_header_methods_.end(), method)
            != cronet_builder_add_header_methods_.end()
        || std::find(cronet_builder_set_upload_methods_.begin(), cronet_builder_set_upload_methods_.end(), method)
            != cronet_builder_set_upload_methods_.end()
        || std::find(cronet_builder_build_methods_.begin(), cronet_builder_build_methods_.end(), method)
            != cronet_builder_build_methods_.end();
}

bool Agent::isGnetCronetBuilderMethod(jmethodID method) const {
    return std::find(gnet_cronet_builder_set_method_methods_.begin(), gnet_cronet_builder_set_method_methods_.end(), method)
            != gnet_cronet_builder_set_method_methods_.end()
        || std::find(gnet_cronet_builder_add_header_methods_.begin(), gnet_cronet_builder_add_header_methods_.end(), method)
            != gnet_cronet_builder_add_header_methods_.end()
        || std::find(gnet_cronet_builder_build_methods_.begin(), gnet_cronet_builder_build_methods_.end(), method)
            != gnet_cronet_builder_build_methods_.end();
}

bool Agent::isCronetReadMethod(jmethodID method) const {
    return std::find(cronet_read_methods_.begin(), cronet_read_methods_.end(), method) != cronet_read_methods_.end();
}

bool Agent::setupJvmtiCapabilities() {
    jvmtiCapabilities caps;
    memset(&caps, 0, sizeof(caps));
    caps.can_generate_breakpoint_events = 1;
    caps.can_retransform_classes = 1;
    caps.can_access_local_variables = 1;
    caps.can_force_early_return = 1;

    jvmtiError err = jvmti_env_->AddCapabilities(&caps);
    if (err == JVMTI_ERROR_NONE) {
        can_force_early_return_ = true;
        LOGI("Capabilities enabled: breakpoints, retransform, early-return");
        return true;
    }

    // Replace Mock is optional. Some ART/ROM combinations do not grant
    // can_force_early_return; retain the established capture capabilities.
    LOGE("AddCapabilities with early-return failed: %d; retrying capture-only", err);
    memset(&caps, 0, sizeof(caps));
    caps.can_generate_breakpoint_events = 1;
    caps.can_retransform_classes = 1;
    caps.can_access_local_variables = 1;
    err = jvmti_env_->AddCapabilities(&caps);
    if (err == JVMTI_ERROR_NONE) {
        can_force_early_return_ = false;
        LOGI("Capabilities enabled: breakpoints, retransform (Cronet Mock Replace disabled)");
        return true;
    }

    LOGE("AddCapabilities capture-only retry failed: %d", err);
    return false;
}

bool Agent::setupEventCallbacks() {
    jvmtiEventCallbacks callbacks;
    memset(&callbacks, 0, sizeof(callbacks));

    callbacks.Breakpoint = [](jvmtiEnv* jvmti, JNIEnv* env,
                               jthread thread, jmethodID method, jlocation location) {
        Agent* agent = Agent::getInstance();

        if (std::find(agent->okhttp_methods_.begin(), agent->okhttp_methods_.end(), method)
                != agent->okhttp_methods_.end()
            && agent->inject_method_ && agent->helper_class_) {
            // Get 'this' (the OkHttpClient instance) using GetLocalInstance
            jobject client = nullptr;
            jvmtiError err = jvmti->GetLocalInstance(thread, 0, &client);
            if (err == JVMTI_ERROR_NONE && client != nullptr) {
                // Call NetworkHookHelper.ensureInterceptorInjected(client)
                env->CallStaticVoidMethod(agent->helper_class_, agent->inject_method_, client);
                env->DeleteLocalRef(client);
            } else {
                LOGE("GetLocalInstance failed: %d", err);
            }
            return;
        }

        if (std::find(agent->cronet_methods_.begin(), agent->cronet_methods_.end(), method)
                != agent->cronet_methods_.end()
            && agent->wrap_cronet_callback_method_ && agent->helper_class_) {
            // ART exposes an implicit receiver in local slot 1 for instance-method
            // breakpoint frames. URL and Callback therefore occupy slots 2 and 3.
            // Replacing the Callback local keeps the caller's original Cronet
            // request lifecycle untouched.
            jobject url = nullptr;
            jobject callback = nullptr;
            jobject executor = nullptr;
            jvmtiError urlErr = jvmti->GetLocalObject(thread, 0, 2, &url);
            jvmtiError callbackErr = jvmti->GetLocalObject(thread, 0, 3, &callback);
            jvmtiError executorErr = jvmti->GetLocalObject(thread, 0, 4, &executor);
            if (urlErr != JVMTI_ERROR_NONE || callbackErr != JVMTI_ERROR_NONE || !callback) {
                LOGE("Cannot read Cronet callback parameters (url=%d callback=%d executor=%d)",
                     urlErr, callbackErr, executorErr);
                if (url) env->DeleteLocalRef(url);
                if (callback) env->DeleteLocalRef(callback);
                if (executor) env->DeleteLocalRef(executor);
                return;
            }
            if (executorErr != JVMTI_ERROR_NONE || !executor) {
                LOGE("Cannot read Cronet executor (%d); capture remains enabled but Mock Replace is unavailable",
                     executorErr);
            }

            jobject wrapped = env->CallStaticObjectMethod(
                agent->helper_class_, agent->wrap_cronet_callback_method_, url, callback, executor);
            if (env->ExceptionCheck()) {
                logJniException(env, "wrapCronetCallback");
            } else if (wrapped && wrapped != callback) {
                jvmtiError setErr = jvmti->SetLocalObject(thread, 0, 3, wrapped);
                if (setErr != JVMTI_ERROR_NONE) {
                    LOGE("Cannot replace Cronet callback parameter: %d", setErr);
                }
            }
            if (wrapped) env->DeleteLocalRef(wrapped);
            if (url) env->DeleteLocalRef(url);
            env->DeleteLocalRef(callback);
            env->DeleteLocalRef(executor);
            return;
        }

        if (std::find(agent->gnet_cronet_methods_.begin(), agent->gnet_cronet_methods_.end(), method)
                != agent->gnet_cronet_methods_.end()
            && agent->wrap_gnet_cronet_callback_method_ && agent->helper_class_) {
            jobject url = nullptr;
            jobject callback = nullptr;
            jobject executor = nullptr;
            jvmtiError urlErr = jvmti->GetLocalObject(thread, 0, 2, &url);
            jvmtiError callbackErr = jvmti->GetLocalObject(thread, 0, 3, &callback);
            jvmtiError executorErr = jvmti->GetLocalObject(thread, 0, 4, &executor);
            if (urlErr != JVMTI_ERROR_NONE || callbackErr != JVMTI_ERROR_NONE || !callback) {
                if (url) env->DeleteLocalRef(url);
                if (callback) env->DeleteLocalRef(callback);
                if (executor) env->DeleteLocalRef(executor);
                return;
            }
            if (executorErr != JVMTI_ERROR_NONE || !executor) {
                LOGE("Cannot read gnet Cronet executor (%d); capture remains enabled but Mock Replace is unavailable",
                     executorErr);
            }
            jobject wrapped = env->CallStaticObjectMethod(
                agent->helper_class_, agent->wrap_gnet_cronet_callback_method_, url, callback, executor);
            if (env->ExceptionCheck()) {
                logJniException(env, "wrapGnetCronetCallback");
            } else if (wrapped && wrapped != callback) {
                jvmtiError setErr = jvmti->SetLocalObject(thread, 0, 3, wrapped);
                if (setErr != JVMTI_ERROR_NONE) LOGE("Cannot replace gnet Cronet callback: %d", setErr);
            }
            if (wrapped) env->DeleteLocalRef(wrapped);
            if (url) env->DeleteLocalRef(url);
            env->DeleteLocalRef(callback);
            env->DeleteLocalRef(executor);
            return;
        }

        const bool isStandardCronetBuilder = agent->isCronetBuilderMethod(method);
        const bool isGnetCronetBuilder = agent->isGnetCronetBuilderMethod(method);
        if ((isStandardCronetBuilder || isGnetCronetBuilder) && agent->helper_class_) {
            jobject builder = nullptr;
            jvmtiError builderErr = jvmti->GetLocalInstance(thread, 0, &builder);
            if (builderErr != JVMTI_ERROR_NONE || !builder) {
                LOGE("Cannot read Cronet builder instance: %d", builderErr);
                if (builder) env->DeleteLocalRef(builder);
                return;
            }

            if (isStandardCronetBuilder && agent->link_cronet_builder_method_) {
                env->CallStaticVoidMethod(agent->helper_class_, agent->link_cronet_builder_method_, builder);
                if (env->ExceptionCheck()) logJniException(env, "linkCronetBuilder");
            } else if (isGnetCronetBuilder && agent->link_gnet_cronet_builder_method_) {
                env->CallStaticVoidMethod(agent->helper_class_, agent->link_gnet_cronet_builder_method_, builder);
                if (env->ExceptionCheck()) logJniException(env, "linkGnetCronetBuilder");
            }

            if (isStandardCronetBuilder && std::find(agent->cronet_builder_set_method_methods_.begin(),
                          agent->cronet_builder_set_method_methods_.end(), method)
                    != agent->cronet_builder_set_method_methods_.end()
                && agent->record_cronet_http_method_) {
                jobject httpMethod = nullptr;
                if (jvmti->GetLocalObject(thread, 0, 2, &httpMethod) == JVMTI_ERROR_NONE && httpMethod) {
                    env->CallStaticVoidMethod(agent->helper_class_, agent->record_cronet_http_method_,
                                              builder, httpMethod);
                    if (env->ExceptionCheck()) logJniException(env, "recordCronetHttpMethod");
                    env->DeleteLocalRef(httpMethod);
                }
            } else if (isStandardCronetBuilder && std::find(agent->cronet_builder_add_header_methods_.begin(),
                                   agent->cronet_builder_add_header_methods_.end(), method)
                           != agent->cronet_builder_add_header_methods_.end()
                && agent->record_cronet_header_method_) {
                jobject headerName = nullptr;
                jobject headerValue = nullptr;
                jvmtiError nameErr = jvmti->GetLocalObject(thread, 0, 2, &headerName);
                jvmtiError valueErr = jvmti->GetLocalObject(thread, 0, 3, &headerValue);
                if (nameErr == JVMTI_ERROR_NONE && valueErr == JVMTI_ERROR_NONE
                    && headerName && headerValue) {
                    env->CallStaticVoidMethod(agent->helper_class_, agent->record_cronet_header_method_,
                                              builder, headerName, headerValue);
                    if (env->ExceptionCheck()) logJniException(env, "recordCronetHeader");
                }
                if (headerName) env->DeleteLocalRef(headerName);
                if (headerValue) env->DeleteLocalRef(headerValue);
            } else if (isStandardCronetBuilder && std::find(agent->cronet_builder_set_upload_methods_.begin(),
                                   agent->cronet_builder_set_upload_methods_.end(), method)
                           != agent->cronet_builder_set_upload_methods_.end()
                && agent->wrap_cronet_upload_provider_method_) {
                jobject provider = nullptr;
                if (jvmti->GetLocalObject(thread, 0, 2, &provider) == JVMTI_ERROR_NONE && provider) {
                    jobject wrappedProvider = env->CallStaticObjectMethod(
                        agent->helper_class_, agent->wrap_cronet_upload_provider_method_,
                        provider, builder);
                    if (env->ExceptionCheck()) {
                        logJniException(env, "wrapCronetUploadProvider");
                    } else if (wrappedProvider && wrappedProvider != provider) {
                        jvmtiError setErr = jvmti->SetLocalObject(thread, 0, 2, wrappedProvider);
                        if (setErr != JVMTI_ERROR_NONE) {
                            LOGE("Cannot replace Cronet upload provider parameter: %d", setErr);
                        }
                    }
                    if (wrappedProvider) env->DeleteLocalRef(wrappedProvider);
                    env->DeleteLocalRef(provider);
                }
            } else if (isGnetCronetBuilder
                && std::find(agent->gnet_cronet_builder_set_method_methods_.begin(),
                             agent->gnet_cronet_builder_set_method_methods_.end(), method)
                    != agent->gnet_cronet_builder_set_method_methods_.end()
                && agent->record_gnet_cronet_http_method_) {
                jobject httpMethod = nullptr;
                if (jvmti->GetLocalObject(thread, 0, 2, &httpMethod) == JVMTI_ERROR_NONE && httpMethod) {
                    env->CallStaticVoidMethod(agent->helper_class_, agent->record_gnet_cronet_http_method_,
                                              builder, httpMethod);
                    if (env->ExceptionCheck()) logJniException(env, "recordGnetCronetHttpMethod");
                    env->DeleteLocalRef(httpMethod);
                }
            } else if (isGnetCronetBuilder
                && std::find(agent->gnet_cronet_builder_add_header_methods_.begin(),
                             agent->gnet_cronet_builder_add_header_methods_.end(), method)
                    != agent->gnet_cronet_builder_add_header_methods_.end()
                && agent->record_gnet_cronet_header_method_) {
                jobject headerName = nullptr;
                jobject headerValue = nullptr;
                jvmtiError nameErr = jvmti->GetLocalObject(thread, 0, 2, &headerName);
                jvmtiError valueErr = jvmti->GetLocalObject(thread, 0, 3, &headerValue);
                if (nameErr == JVMTI_ERROR_NONE && valueErr == JVMTI_ERROR_NONE
                    && headerName && headerValue) {
                    env->CallStaticVoidMethod(agent->helper_class_, agent->record_gnet_cronet_header_method_,
                                              builder, headerName, headerValue);
                    if (env->ExceptionCheck()) logJniException(env, "recordGnetCronetHeader");
                }
                if (headerName) env->DeleteLocalRef(headerName);
                if (headerValue) env->DeleteLocalRef(headerValue);
            }

            const bool isBuild = (isStandardCronetBuilder
                && std::find(agent->cronet_builder_build_methods_.begin(),
                             agent->cronet_builder_build_methods_.end(), method)
                    != agent->cronet_builder_build_methods_.end())
                || (isGnetCronetBuilder
                    && std::find(agent->gnet_cronet_builder_build_methods_.begin(),
                                 agent->gnet_cronet_builder_build_methods_.end(), method)
                        != agent->gnet_cronet_builder_build_methods_.end());
            if (isBuild && agent->can_force_early_return_) {
                jmethodID factory = isStandardCronetBuilder
                    ? agent->create_cronet_mock_request_method_
                    : agent->create_gnet_cronet_mock_request_method_;
                if (factory) {
                    jobject mockRequest = env->CallStaticObjectMethod(agent->helper_class_, factory, builder);
                    if (env->ExceptionCheck()) {
                        logJniException(env, "createCronetMockRequest");
                    } else if (mockRequest) {
                        jvmtiError earlyReturnErr = jvmti->ForceEarlyReturnObject(thread, mockRequest);
                        if (earlyReturnErr == JVMTI_ERROR_NONE) {
                            LOGI("%s Cronet Mock Replace returned from Builder.build()",
                                 isStandardCronetBuilder ? "standard" : "gnet");
                            env->DeleteLocalRef(mockRequest);
                            env->DeleteLocalRef(builder);
                            return;
                        }
                        LOGE("ForceEarlyReturnObject failed: %d; allowing real Cronet request", earlyReturnErr);
                    }
                    if (mockRequest) env->DeleteLocalRef(mockRequest);
                }
            }

            env->DeleteLocalRef(builder);
            return;
        }

        if (agent->isCronetReadMethod(method) && agent->record_cronet_read_start_method_
            && agent->helper_class_) {
            jobject request = nullptr;
            jobject buffer = nullptr;
            jvmtiError requestErr = jvmti->GetLocalInstance(thread, 0, &request);
            jvmtiError bufferErr = jvmti->GetLocalObject(thread, 0, 2, &buffer);
            if (requestErr == JVMTI_ERROR_NONE && bufferErr == JVMTI_ERROR_NONE
                && request && buffer) {
                env->CallStaticVoidMethod(agent->helper_class_, agent->record_cronet_read_start_method_,
                                          request, buffer);
                if (env->ExceptionCheck()) logJniException(env, "recordCronetReadStart");
            }
            if (request) env->DeleteLocalRef(request);
            if (buffer) env->DeleteLocalRef(buffer);
        }
    };

    callbacks.ClassPrepare = [](jvmtiEnv*, JNIEnv* env, jthread, jclass klass) {
        Agent::getInstance()->hookClassIfSupported(env, klass);
    };

    callbacks.VMDeath = [](jvmtiEnv* jvmti, JNIEnv* env) {
        Agent::getInstance()->shutdown();
    };

    jvmtiError err = jvmti_env_->SetEventCallbacks(&callbacks, sizeof(callbacks));
    if (err != JVMTI_ERROR_NONE) {
        LOGE("SetEventCallbacks failed: %d", err);
        return false;
    }

    err = jvmti_env_->SetEventNotificationMode(JVMTI_ENABLE, JVMTI_EVENT_VM_DEATH, nullptr);
    if (err != JVMTI_ERROR_NONE) {
        LOGE("Failed to enable VM_DEATH event: %d", err);
        return false;
    }

    err = jvmti_env_->SetEventNotificationMode(JVMTI_ENABLE, JVMTI_EVENT_CLASS_PREPARE, nullptr);
    if (err != JVMTI_ERROR_NONE) {
        // Existing loaded classes were scanned during initialization. Some ART
        // builds do not expose delayed class discovery to attach agents; this
        // must not disable the established OkHttp capture path.
        LOGE("CLASS_PREPARE unavailable; late-loaded Cronet classes will not be hooked: %d", err);
    }

    return true;
}

bool Agent::loadHelperDex(JNIEnv* env) {
    // Get app context for classloader
    jclass activityThread = env->FindClass("android/app/ActivityThread");
    if (!activityThread) { env->ExceptionClear(); return false; }

    jmethodID currentApp = env->GetStaticMethodID(activityThread, "currentApplication",
                                                   "()Landroid/app/Application;");
    jobject app = env->CallStaticObjectMethod(activityThread, currentApp);
    if (!app) { env->ExceptionClear(); return false; }

    // Get app classloader
    jclass ctxCls = env->FindClass("android/content/Context");
    jmethodID getClassLoader = env->GetMethodID(ctxCls,
        "getClassLoader", "()Ljava/lang/ClassLoader;");
    jobject appClassLoader = env->CallObjectMethod(app, getClassLoader);
    env->DeleteLocalRef(app);
    if (!appClassLoader) { env->ExceptionClear(); LOGE("Cannot get app classloader"); return false; }

    LOGI("Loading helper DEX (%zu bytes) via InMemoryDexClassLoader", HELPER_DEX_SIZE);

    // Create direct ByteBuffer with DEX bytes
    jclass byteBufferClass = env->FindClass("java/nio/ByteBuffer");
    jmethodID allocateDirect = env->GetStaticMethodID(byteBufferClass,
        "allocateDirect", "(I)Ljava/nio/ByteBuffer;");
    jobject buffer = env->CallStaticObjectMethod(byteBufferClass, allocateDirect, (jint)HELPER_DEX_SIZE);
    if (!buffer) {
        logJniException(env, "allocateDirect");
        env->DeleteLocalRef(appClassLoader);
        return false;
    }

    void* bufPtr = env->GetDirectBufferAddress(buffer);
    if (!bufPtr) {
        LOGE("GetDirectBufferAddress failed");
        env->DeleteLocalRef(buffer);
        env->DeleteLocalRef(appClassLoader);
        return false;
    }
    memcpy(bufPtr, HELPER_DEX_BYTES, HELPER_DEX_SIZE);

    // Create InMemoryDexClassLoader(ByteBuffer, ClassLoader)
    jclass imClClass = env->FindClass("dalvik/system/InMemoryDexClassLoader");
    if (!imClClass) {
        logJniException(env, "InMemoryDexClassLoader class");
        env->DeleteLocalRef(buffer);
        env->DeleteLocalRef(appClassLoader);
        return false;
    }

    jmethodID imClInit = env->GetMethodID(imClClass, "<init>",
        "(Ljava/nio/ByteBuffer;Ljava/lang/ClassLoader;)V");
    jobject dexCl = env->NewObject(imClClass, imClInit, buffer, appClassLoader);

    env->DeleteLocalRef(buffer);
    env->DeleteLocalRef(appClassLoader);

    if (!dexCl) {
        logJniException(env, "InMemoryDexClassLoader");
        return false;
    }

    LOGI("InMemoryDexClassLoader created");

    // Load helper class via DexClassLoader
    jclass classLoaderClass = env->FindClass("java/lang/ClassLoader");
    jmethodID loadClassMethod = env->GetMethodID(classLoaderClass, "loadClass",
        "(Ljava/lang/String;)Ljava/lang/Class;");
    jstring helperClassName = env->NewStringUTF("com.hadice.agent.NetworkHookHelper");
    jclass localHelperClass = (jclass)env->CallObjectMethod(dexCl, loadClassMethod, helperClassName);

    env->DeleteLocalRef(helperClassName);
    env->DeleteLocalRef(dexCl);

    if (!localHelperClass) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        LOGE("Failed to load NetworkHookHelper via DexClassLoader");
        return false;
    }

    helper_class_ = (jclass)env->NewGlobalRef(localHelperClass);
    env->DeleteLocalRef(localHelperClass);
    if (!helper_class_) {
        LOGE("Failed to create global ref for NetworkHookHelper");
        return false;
    }

    LOGI("Helper class loaded via DexClassLoader");
    return true;
}

bool Agent::registerHelperNatives(JNIEnv* env) {
    // helper_class_ was set by loadHelperDex
    if (!helper_class_) return false;

    JNINativeMethod methods[] = {
        {
            const_cast<char*>("nativeSendMessage"),
            const_cast<char*>("(Ljava/lang/String;)V"),
            reinterpret_cast<void*>(nativeSendMessage)
        }
    };

    jint regResult = env->RegisterNatives(helper_class_, methods, 1);
    if (regResult != JNI_OK) {
        LOGE("RegisterNatives failed: %d", regResult);
        env->ExceptionClear();
        return false;
    }

    LOGI("JNI native methods registered for NetworkHookHelper");
    return true;
}

void Agent::handleServerMessage(const std::string& message) {
    JNIEnv* env = getJniEnv();
    if (!env || !helper_class_) return;

    if (!update_mock_config_method_) {
        update_mock_config_method_ = env->GetStaticMethodID(
            helper_class_, "updateMockConfig", "(Ljava/lang/String;)V");
        if (!update_mock_config_method_) {
            logJniException(env, "find updateMockConfig");
            return;
        }
    }

    jstring jmessage = env->NewStringUTF(message.c_str());
    if (!jmessage) return;
    env->CallStaticVoidMethod(helper_class_, update_mock_config_method_, jmessage);
    env->DeleteLocalRef(jmessage);
    if (env->ExceptionCheck()) {
        logJniException(env, "updateMockConfig");
    }
}

void Agent::shutdown() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!initialized_) return;

    for (jmethodID method : okhttp_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : cronet_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : gnet_cronet_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : cronet_builder_set_method_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : cronet_builder_add_header_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : cronet_builder_set_upload_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : cronet_builder_build_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : gnet_cronet_builder_set_method_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : gnet_cronet_builder_add_header_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : gnet_cronet_builder_build_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    for (jmethodID method : cronet_read_methods_) {
        jvmti_env_->ClearBreakpoint(method, 0);
    }
    okhttp_methods_.clear();
    cronet_methods_.clear();
    gnet_cronet_methods_.clear();
    cronet_builder_set_method_methods_.clear();
    cronet_builder_add_header_methods_.clear();
    cronet_builder_set_upload_methods_.clear();
    cronet_builder_build_methods_.clear();
    gnet_cronet_builder_set_method_methods_.clear();
    gnet_cronet_builder_add_header_methods_.clear();
    gnet_cronet_builder_build_methods_.clear();
    cronet_read_methods_.clear();
    jvmti_env_->SetEventNotificationMode(JVMTI_DISABLE, JVMTI_EVENT_BREAKPOINT, nullptr);
    jvmti_env_->SetEventNotificationMode(JVMTI_DISABLE, JVMTI_EVENT_CLASS_PREPARE, nullptr);
    jvmti_env_->SetEventNotificationMode(JVMTI_DISABLE, JVMTI_EVENT_VM_DEATH, nullptr);
    SocketClient::getInstance()->stopBackgroundThreads();
    if (helper_class_) {
        JNIEnv* env = getJniEnv();
        if (env) env->DeleteGlobalRef(helper_class_);
        helper_class_ = nullptr;
    }
    initialized_ = false;
    LOGI("NetworkAgent shutdown");
}

}

extern "C" {

JNIEXPORT jint JNICALL Agent_OnLoad(JavaVM* vm, char* options, void* reserved) {
    return JNI_OK;
}

JNIEXPORT jint JNICALL Agent_OnAttach(JavaVM* vm, char* options, void* reserved) {
    return network_agent::Agent::getInstance()->initialize(vm, options) ? JNI_OK : JNI_ERR;
}

JNIEXPORT void JNICALL Agent_OnUnload(JavaVM* vm) {
    network_agent::Agent::getInstance()->shutdown();
}

}
