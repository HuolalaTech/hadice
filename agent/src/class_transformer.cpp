#include "class_transformer.h"
#include "bytecode_transformer.h"

#include <android/log.h>
#include <cstring>
#include <algorithm>

#define LOG_TAG "ClassTransformer"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

namespace network_agent {

ClassTransformer* ClassTransformer::getInstance() {
    static ClassTransformer instance;
    return &instance;
}

bool ClassTransformer::setup(jvmtiEnv* jvmti, JavaVM* vm) {
    jvmti_ = jvmti;
    java_vm_ = vm;
    initialized_ = true;
    LOGI("ClassTransformer initialized");
    return true;
}

void ClassTransformer::onClassFileLoadHook(jvmtiEnv* jvmti, JNIEnv* env,
                                            jclass class_being_redefined,
                                            jobject loader,
                                            const char* name,
                                            jobject protection_domain,
                                            jint class_data_len,
                                            const unsigned char* class_data,
                                            jint* new_class_data_len,
                                            unsigned char** new_class_data) {
    if (!initialized_ || name == nullptr) {
        return;
    }

    // Only transform OkHttpClient$Builder
    if (strcmp(name, "okhttp3/OkHttpClient$Builder") == 0) {
        LOGI("Found OkHttpClient$Builder, transforming build() method");
        transformBuilderBuild(class_data, class_data_len, new_class_data_len, new_class_data);
    }
}

/**
 * Transform OkHttpClient$Builder.build() to inject our interceptor.
 *
 * The transformation is minimal: just prepend one static method call before the
 * original build() code:
 *
 *   Original:                        Transformed:
 *     <original code>                  ALOAD_0
 *                                     INVOKESTATIC NetworkHookHelper.injectInterceptor(Object)V
 *                                     <original code>
 *
 * This adds 3 bytes (ALOAD_0=0x2A + INVOKESTATIC=0xB8 + 2-byte index) and
 * increases max_stack by 1.
 */
bool ClassTransformer::transformBuilderBuild(const unsigned char* class_data, jint class_data_len,
                                              jint* new_class_data_len, unsigned char** new_class_data) {
    // Parse the class file
    ClassFile classFile;
    if (!classFile.parse(class_data, class_data_len)) {
        LOGE("Failed to parse OkHttpClient$Builder class file");
        return false;
    }

    // Find the build() method - signature: ()Lokhttp3/OkHttpClient;
    int methodIdx = classFile.findMethod("build", "()Lokhttp3/OkHttpClient;");
    if (methodIdx < 0) {
        // Try alternate signature for newer OkHttp versions
        methodIdx = classFile.findMethod("build", "()Ljava/lang/Object;");
    }
    if (methodIdx < 0) {
        LOGE("build() method not found in OkHttpClient$Builder");
        return false;
    }

    LOGI("Found build() method at index %d", methodIdx);

    std::vector<MethodInfo>& methods = classFile.getMethods();
    MethodInfo& method = methods[methodIdx];

    if (method.code.empty()) {
        LOGE("build() method has no code (abstract/native?)");
        return false;
    }

    LOGI("Original code size: %d, max_stack: %d, max_locals: %d",
         (int)method.code.size(), method.max_stack, method.max_locals);

    // Add constant pool entry for NetworkHookHelper.injectInterceptor(Object)V
    uint16_t injectMethodIdx = classFile.addMethodref(
        "com/hadice/agent/NetworkHookHelper",
        "injectInterceptor",
        "(Ljava/lang/Object;)V"
    );

    // Build the injection bytecode:
    //   ALOAD_0         (0x2A)          - push 'this' (the Builder)
    //   INVOKESTATIC    (0xB8) idx_hi idx_lo  - call injectInterceptor(this)
    std::vector<uint8_t> injectCode;
    injectCode.push_back(0x2A);                     // ALOAD_0
    injectCode.push_back(0xB8);                     // INVOKESTATIC
    injectCode.push_back((injectMethodIdx >> 8) & 0xff);
    injectCode.push_back(injectMethodIdx & 0xff);

    // Prepend injection code before the original method code
    method.code.insert(method.code.begin(), injectCode.begin(), injectCode.end());
    method.code_length = method.code.size();

    // Increase max_stack by 1 to account for the extra ALOAD_0
    method.max_stack = std::max((int)method.max_stack, 2);

    LOGI("Injected interceptor call (%d bytes), new code size: %d",
         (int)injectCode.size(), (int)method.code.size());

    // Build the modified class file
    std::vector<uint8_t> newClassData = classFile.build();

    // Allocate JVMTI memory for the modified class
    jvmtiError err = jvmti_->Allocate(newClassData.size(), new_class_data);
    if (err != JVMTI_ERROR_NONE) {
        LOGE("Failed to allocate memory for modified class: %d", err);
        return false;
    }

    memcpy(*new_class_data, newClassData.data(), newClassData.size());
    *new_class_data_len = newClassData.size();

    LOGI("Successfully transformed OkHttpClient$Builder (%d -> %d bytes)",
         (int)class_data_len, (int)newClassData.size());

    return true;
}

}
