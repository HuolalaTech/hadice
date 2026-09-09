#ifndef BYTECODE_TRANSFORMER_H
#define BYTECODE_TRANSFORMER_H

#include <jvmti.h>
#include <jni.h>
#include <string>
#include <vector>
#include <cstdint>

namespace network_agent {

// JVM bytecode constants
enum class ConstantTag : uint8_t {
    CONSTANT_Utf8 = 1,
    CONSTANT_Integer = 3,
    CONSTANT_Float = 4,
    CONSTANT_Long = 5,
    CONSTANT_Double = 6,
    CONSTANT_Class = 7,
    CONSTANT_String = 8,
    CONSTANT_Fieldref = 9,
    CONSTANT_Methodref = 10,
    CONSTANT_InterfaceMethodref = 11,
    CONSTANT_NameAndType = 12,
    CONSTANT_MethodHandle = 15,
    CONSTANT_MethodType = 16,
    CONSTANT_Dynamic = 17,
    CONSTANT_InvokeDynamic = 18,
    CONSTANT_Module = 19,
    CONSTANT_Package = 20
};

// Constant pool entry
struct ConstantPoolEntry {
    ConstantTag tag;
    std::vector<uint8_t> data;
    int index;
};

// Method info
struct MethodInfo {
    uint16_t access_flags;
    uint16_t name_index;
    uint16_t descriptor_index;
    std::vector<uint8_t> code;
    uint16_t max_stack;
    uint16_t max_locals;
    uint16_t code_length;
    std::vector<uint8_t> code_suffix;
    std::vector<uint8_t> other_attributes_data;
    uint16_t other_attributes_count = 0;
    bool has_code = false;
};

// Class file structure
class ClassFile {
public:
    bool parse(const uint8_t* data, size_t len);
    std::vector<uint8_t> build();
    
    uint16_t addUtf8(const std::string& str);
    uint16_t addClass(const std::string& className);
    uint16_t addNameAndType(const std::string& name, const std::string& descriptor);
    uint16_t addMethodref(const std::string& className, const std::string& name, const std::string& descriptor);
    uint16_t addFieldref(const std::string& className, const std::string& name, const std::string& descriptor);
    uint16_t addString(const std::string& str);
    uint16_t addInteger(int32_t value);
    
    int findMethod(const std::string& name, const std::string& descriptor);
    bool injectMethodCall(int methodIndex, const std::string& className, 
                          const std::string& methodName, const std::string& methodDesc,
                          bool atEntry, bool captureResult = false);
    
    void dumpInfo();
    
    std::vector<MethodInfo>& getMethods() { return methods_; }
    std::vector<ConstantPoolEntry>& getConstantPool() { return constant_pool_; }
    uint16_t getConstantPoolCount() const { return constant_pool_count_; }
    void setConstantPoolCount(uint16_t count) { constant_pool_count_ = count; }

private:
    uint32_t magic_;
    uint16_t minor_version_;
    uint16_t major_version_;
    
    std::vector<ConstantPoolEntry> constant_pool_;
    uint16_t constant_pool_count_;
    
    uint16_t access_flags_;
    uint16_t this_class_;
    uint16_t super_class_;
    
    std::vector<uint16_t> interfaces_;
    
    struct FieldInfo {
        uint16_t access_flags;
        uint16_t name_index;
        uint16_t descriptor_index;
        uint16_t attributes_count = 0;
        std::vector<uint8_t> attributes;
    };
    std::vector<FieldInfo> fields_;
    
    std::vector<MethodInfo> methods_;
    
    std::vector<uint8_t> attributes_;
    
    int findUtf8(const std::string& str);
    int findClass(const std::string& className);
    const char* getUtf8(uint16_t index);
};

// Bytecode injector
class BytecodeInjector {
public:
    // Inject a method call at the beginning of a method
    static std::vector<uint8_t> injectAtEntry(const std::vector<uint8_t>& originalCode,
                                               uint16_t maxStack,
                                               uint16_t& newMaxStack,
                                               const std::vector<uint8_t>& callBytes);
    
    // Inject a method call before method return
    static std::vector<uint8_t> injectAtExit(const std::vector<uint8_t>& originalCode,
                                              uint16_t maxStack,
                                              uint16_t& newMaxStack,
                                              const std::vector<uint8_t>& callBytes,
                                              bool saveResult = false,
                                              int resultSlot = -1);
    
    // Generate bytecode to call a static method
    static std::vector<uint8_t> generateStaticCall(uint16_t methodrefIndex);
    
    // Generate bytecode to load local variable
    static std::vector<uint8_t> generateLoadLocal(int slot, const std::string& type);
    
    // Generate bytecode to store result
    static std::vector<uint8_t> generateStoreLocal(int slot, const std::string& type);
};

// Helper class injector
class HelperInjector {
public:
    // Inject NetworkHookHelper class into the app's classloader
    static bool injectHelperClass(JNIEnv* env, jobject loader);
    
    // Get the bytecode of the helper class
    static std::vector<uint8_t> getHelperClassBytes();
    
private:
    // The compiled NetworkHookHelper.class as bytes
    // This will be embedded in the agent
    static const uint8_t helper_class_bytes_[];
    static const size_t helper_class_size_;
};

}

#endif