cmake_minimum_required(VERSION 3.22)
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

add_library(network_agent SHARED ${AGENT_SOURCES})

target_include_directories(network_agent PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${JAVA_HOME}/include
    ${JAVA_HOME}/include/darwin
)

target_link_libraries(network_agent
    log
    android
)

set_target_properties(network_agent PROPERTIES
    OUTPUT_NAME "network_agent"
    PREFIX "lib"
)

add_custom_command(TARGET network_agent POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy
        $<TARGET_FILE:network_agent>
        ${CMAKE_CURRENT_SOURCE_DIR}/build/${ANDROID_ABI}/
)