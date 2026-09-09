#ifndef CLASS_TRANSFORMER_H
#define CLASS_TRANSFORMER_H

#include <jvmti.h>
#include <jni.h>
#include <string>

namespace network_agent {

/**
 * Simplified class transformer.
 * Only transforms OkHttpClient$Builder.build() to inject our interceptor.
 */
class ClassTransformer {
public:
    static ClassTransformer* getInstance();

    bool setup(jvmtiEnv* jvmti, JavaVM* vm);

    void onClassFileLoadHook(jvmtiEnv* jvmti, JNIEnv* env,
                              jclass class_being_redefined,
                              jobject loader,
                              const char* name,
                              jobject protection_domain,
                              jint class_data_len,
                              const unsigned char* class_data,
                              jint* new_class_data_len,
                              unsigned char** new_class_data);

private:
    ClassTransformer() = default;

    bool transformBuilderBuild(const unsigned char* class_data, jint class_data_len,
                               jint* new_class_data_len, unsigned char** new_class_data);

    jvmtiEnv* jvmti_ = nullptr;
    JavaVM* java_vm_ = nullptr;
    bool initialized_ = false;
};

}

#endif
