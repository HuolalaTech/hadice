// The build force-includes the Android NDK's jni.h immediately before this
// file. jvmti.h then includes the desktop JDK's jni.h by name, so mark that
// header as already included to keep the Android target ABI in use.
#ifndef _JAVASOFT_JNI_H_
#define _JAVASOFT_JNI_H_
#endif
