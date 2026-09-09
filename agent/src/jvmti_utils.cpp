#include "jvmti_utils.h"
#include <android/log.h>
#include <cstdarg>
#include <cstring>

#define LOG_TAG "JvmtiUtils"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace network_agent {

std::string JvmtiUtils::jstringToString(JNIEnv* env, jstring str) {
    if (str == nullptr) {
        return "";
    }
    
    const char* chars = env->GetStringUTFChars(str, nullptr);
    if (chars == nullptr) {
        return "";
    }
    
    std::string result(chars);
    env->ReleaseStringUTFChars(str, chars);
    return result;
}

jstring JvmtiUtils::stringToJstring(JNIEnv* env, const std::string& str) {
    return env->NewStringUTF(str.c_str());
}

std::string JvmtiUtils::getMethodSignature(jvmtiEnv* jvmti, jmethodID method) {
    char* signature = nullptr;
    jvmtiError err = jvmti->GetMethodName(method, nullptr, &signature, nullptr);
    
    if (err != JVMTI_ERROR_NONE || signature == nullptr) {
        return "";
    }
    
    std::string result(signature);
    jvmti->Deallocate(reinterpret_cast<unsigned char*>(signature));
    return result;
}

std::string JvmtiUtils::getClassName(jvmtiEnv* jvmti, jclass klass) {
    char* className = nullptr;
    jvmtiError err = jvmti->GetClassSignature(klass, &className, nullptr);
    
    if (err != JVMTI_ERROR_NONE || className == nullptr) {
        return "";
    }
    
    std::string result(className);
    jvmti->Deallocate(reinterpret_cast<unsigned char*>(className));
    
    if (!result.empty() && result[0] == 'L' && result[result.length() - 1] == ';') {
        result = result.substr(1, result.length() - 2);
    }
    
    return result;
}

std::string JvmtiUtils::getMethodName(jvmtiEnv* jvmti, jmethodID method) {
    char* name = nullptr;
    jvmtiError err = jvmti->GetMethodName(method, &name, nullptr, nullptr);
    
    if (err != JVMTI_ERROR_NONE || name == nullptr) {
        return "";
    }
    
    std::string result(name);
    jvmti->Deallocate(reinterpret_cast<unsigned char*>(name));
    return result;
}

bool JvmtiUtils::findClass(jvmtiEnv* jvmti, JNIEnv* env, const char* className, jclass* result) {
    jclass localClass = env->FindClass(className);
    if (localClass == nullptr) {
        env->ExceptionClear();
        return false;
    }
    
    *result = reinterpret_cast<jclass>(env->NewGlobalRef(localClass));
    env->DeleteLocalRef(localClass);
    return true;
}

bool JvmtiUtils::isClassLoaded(jvmtiEnv* jvmti, const char* className) {
    jint classCount = 0;
    jclass* classes = nullptr;
    
    jvmtiError err = jvmti->GetLoadedClasses(&classCount, &classes);
    if (err != JVMTI_ERROR_NONE) {
        return false;
    }
    
    bool found = false;
    std::string targetName(className);
    
    for (int i = 0; i < classCount; i++) {
        std::string name = getClassName(jvmti, classes[i]);
        if (name == targetName) {
            found = true;
            break;
        }
    }
    
    jvmti->Deallocate(reinterpret_cast<unsigned char*>(classes));
    return found;
}

std::vector<jclass> JvmtiUtils::getLoadedClasses(jvmtiEnv* jvmti) {
    std::vector<jclass> result;
    
    jint classCount = 0;
    jclass* classes = nullptr;
    
    jvmtiError err = jvmti->GetLoadedClasses(&classCount, &classes);
    if (err != JVMTI_ERROR_NONE) {
        return result;
    }
    
    for (int i = 0; i < classCount; i++) {
        result.push_back(classes[i]);
    }
    
    jvmti->Deallocate(reinterpret_cast<unsigned char*>(classes));
    return result;
}

void JvmtiUtils::logError(jvmtiEnv* jvmti, const char* format, ...) {
    va_list args;
    va_start(args, format);
    __android_log_vprint(ANDROID_LOG_ERROR, LOG_TAG, format, args);
    va_end(args);
}

void JvmtiUtils::logInfo(jvmtiEnv* jvmti, const char* format, ...) {
    va_list args;
    va_start(args, format);
    __android_log_vprint(ANDROID_LOG_INFO, LOG_TAG, format, args);
    va_end(args);
}

std::string JvmtiUtils::getThreadName(jvmtiEnv* jvmti, jthread thread) {
    jvmtiThreadInfo info;
    jvmtiError err = jvmti->GetThreadInfo(thread, &info);
    
    if (err != JVMTI_ERROR_NONE || info.name == nullptr) {
        return "";
    }
    
    std::string result(info.name);
    jvmti->Deallocate(reinterpret_cast<unsigned char*>(info.name));
    return result;
}

}