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

set(ANDROID_JNI_INCLUDE "${CMAKE_SYSROOT}/usr/include")
if(NOT EXISTS "${ANDROID_JNI_INCLUDE}/jni.h")
    message(FATAL_ERROR "Android jni.h not found in CMAKE_SYSROOT: ${CMAKE_SYSROOT}")
endif()

add_library(network_agent SHARED ${AGENT_SOURCES})

target_include_directories(network_agent PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${JAVA_HOME}/include
)

# jvmti.h comes from the desktop JDK and includes jni.h by name. Force-load
# the NDK header first, then prevent that host JNI header from replacing the
# Android target ABI. `${ANDROID_JNI_INCLUDE}` is an implicit compiler include
# path, so it must be force-included rather than merely added as `-I`.
target_compile_options(network_agent PRIVATE
    "-include${ANDROID_JNI_INCLUDE}/jni.h"
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
