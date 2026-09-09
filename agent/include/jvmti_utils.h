#ifndef JVMTI_UTILS_H
#define JVMTI_UTILS_H

#include <jvmti.h>
#include <jni.h>
#include <string>
#include <vector>

namespace network_agent {

class JvmtiUtils {
public:
    static std::string jstringToString(JNIEnv* env, jstring str);
    static jstring stringToJstring(JNIEnv* env, const std::string& str);
    
    static std::string getMethodSignature(jvmtiEnv* jvmti, jmethodID method);
    static std::string getClassName(jvmtiEnv* jvmti, jclass klass);
    static std::string getMethodName(jvmtiEnv* jvmti, jmethodID method);
    
    static bool findClass(jvmtiEnv* jvmti, JNIEnv* env, const char* className, jclass* result);
    
    static bool isClassLoaded(jvmtiEnv* jvmti, const char* className);
    
    static std::vector<jclass> getLoadedClasses(jvmtiEnv* jvmti);
    
    static bool redefineClass(jvmtiEnv* jvmti, jclass klass, const unsigned char* classBytes, int classBytesLen);
    
    static void logError(jvmtiEnv* jvmti, const char* format, ...);
    static void logInfo(jvmtiEnv* jvmti, const char* format, ...);
    
    static std::string getThreadName(jvmtiEnv* jvmti, jthread thread);
};

}

#endif