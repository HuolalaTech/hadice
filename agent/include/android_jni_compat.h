// Force the Android JNI ABI before the desktop JDK's jvmti.h is included.
// jvmti.h includes "jni.h" by name, which would otherwise select the host
// JDK header and expose incompatible Windows-only JNI types.
#include <jni.h>
#ifndef _JAVASOFT_JNI_H_
#define _JAVASOFT_JNI_H_
#endif
