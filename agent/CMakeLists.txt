cmake_minimum_required(VERSION 3.10)
project(network_agent CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED JAVA_HOME)
    if(DEFINED ENV{JAVA_HOME})
        set(JAVA_HOME $ENV{JAVA_HOME})
    else()
        execute_process(
            COMMAND /usr/libexec/java_home
            OUTPUT_VARIABLE JAVA_HOME
            OUTPUT_STRIP_TRAILING_WHITESPACE
        )
    endif()
endif()

if(NOT EXISTS "${JAVA_HOME}/include/jvmti.h")
    message(FATAL_ERROR "jvmti.h not found. Please set JAVA_HOME environment variable.")
endif()

message(STATUS "Using JAVA_HOME: ${JAVA_HOME}")

set(AGENT_SOURCES
    src/agent.cpp
    src/jvmti_utils.cpp
    src/class_transformer.cpp
    src/socket_client.cpp
    src/json_serializer.cpp
    src/bytecode_transformer.cpp
)

if(DEFINED ANDROID_NDK_ROOT)
    set(ANDROID_JNI_INCLUDE "${ANDROID_NDK_ROOT}/sysroot/usr/include")
elseif(DEFINED ANDROID_NDK)
    set(ANDROID_JNI_INCLUDE "${ANDROID_NDK}/sysroot/usr/include")
elseif(DEFINED CMAKE_ANDROID_NDK)
    set(ANDROID_JNI_INCLUDE "${CMAKE_ANDROID_NDK}/sysroot/usr/include")
endif()

add_library(network_agent SHARED ${AGENT_SOURCES})

target_include_directories(network_agent PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    # Use Android's JNI ABI definitions; the desktop JDK jni.h is not
    # compatible with the Android cross-compiler's target types.
    ${ANDROID_JNI_INCLUDE}
    ${JAVA_HOME}/include
)

# jvmti.h includes the desktop JDK jni.h by name. Force-include a small
# compatibility header so the Android JNI ABI is loaded first and the
# incompatible desktop header is skipped afterwards.
target_compile_options(network_agent PRIVATE
    "-include${CMAKE_CURRENT_SOURCE_DIR}/include/android_jni_compat.h"
)

target_link_libraries(network_agent
    log
    android
)

set_target_properties(network_agent PROPERTIES
    OUTPUT_NAME "network_agent"
    PREFIX "lib"
)

# The per-ABI CMake build directory is already
# `${CMAKE_CURRENT_SOURCE_DIR}/build/${ANDROID_ABI}`, so the target output is
# in the required location. A post-build copy to that same path truncates the
# just-created shared library on Windows (and is unnecessary on other hosts).
