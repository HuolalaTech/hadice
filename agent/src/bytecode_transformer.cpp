#include "bytecode_transformer.h"
#include <android/log.h>
#include <cstring>
#include <algorithm>

#define LOG_TAG "BytecodeTransformer"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

namespace network_agent {

// JVM bytecode opcodes
enum Opcode : uint8_t {
    OP_NOP = 0x00,
    OP_ACONST_NULL = 0x01,
    OP_ICONST_M1 = 0x02,
    OP_ICONST_0 = 0x03,
    OP_ICONST_1 = 0x04,
    OP_ICONST_2 = 0x05,
    OP_ICONST_3 = 0x06,
    OP_ICONST_4 = 0x07,
    OP_ICONST_5 = 0x08,
    OP_LCONST_0 = 0x09,
    OP_LCONST_1 = 0x0a,
    OP_FCONST_0 = 0x0b,
    OP_DCONST_0 = 0x0e,
    OP_BIPUSH = 0x10,
    OP_SIPUSH = 0x11,
    OP_LDC = 0x12,
    OP_LDC_W = 0x13,
    OP_LDC2_W = 0x14,
    OP_ILOAD = 0x15,
    OP_LLOAD = 0x16,
    OP_FLOAD = 0x17,
    OP_DLOAD = 0x18,
    OP_ALOAD = 0x19,
    OP_ILOAD_0 = 0x1a,
    OP_ILOAD_1 = 0x1b,
    OP_ILOAD_2 = 0x1c,
    OP_ILOAD_3 = 0x1d,
    OP_LLOAD_0 = 0x1e,
    OP_LLOAD_1 = 0x1f,
    OP_FLOAD_0 = 0x22,
    OP_ALOAD_0 = 0x2a,
    OP_ALOAD_1 = 0x2b,
    OP_ALOAD_2 = 0x2c,
    OP_ALOAD_3 = 0x2d,
    OP_IALOAD = 0x2e,
    OP_AALOAD = 0x32,
    OP_ISTORE = 0x36,
    OP_LSTORE = 0x37,
    OP_FSTORE = 0x38,
    OP_DSTORE = 0x39,
    OP_ASTORE = 0x3a,
    OP_ISTORE_0 = 0x3b,
    OP_ISTORE_1 = 0x3c,
    OP_ISTORE_2 = 0x3d,
    OP_ISTORE_3 = 0x3e,
    OP_LSTORE_0 = 0x3f,
    OP_LSTORE_1 = 0x40,
    OP_ASTORE_0 = 0x4b,
    OP_ASTORE_1 = 0x4c,
    OP_ASTORE_2 = 0x4d,
    OP_ASTORE_3 = 0x4e,
    OP_POP = 0x57,
    OP_POP2 = 0x58,
    OP_DUP = 0x59,
    OP_DUP_X1 = 0x5a,
    OP_DUP_X2 = 0x5b,
    OP_DUP2 = 0x5c,
    OP_SWAP = 0x5f,
    OP_IADD = 0x60,
    OP_LADD = 0x61,
    OP_ISUB = 0x64,
    OP_IMUL = 0x68,
    OP_IINC = 0x84,
    OP_I2L = 0x85,
    OP_I2F = 0x86,
    OP_I2D = 0x87,
    OP_L2I = 0x88,
    OP_L2F = 0x89,
    OP_F2I = 0x8b,
    OP_D2I = 0x8e,
    OP_D2L = 0x8f,
    OP_I2B = 0x91,
    OP_I2C = 0x92,
    OP_I2S = 0x93,
    OP_LCMP = 0x94,
    OP_IFEQ = 0x99,
    OP_IFNE = 0x9a,
    OP_IFLT = 0x9b,
    OP_IFGE = 0x9c,
    OP_IFGT = 0x9d,
    OP_IFLE = 0x9e,
    OP_IF_ICMPEQ = 0x9f,
    OP_IF_ICMPNE = 0xa0,
    OP_IF_ICMPLT = 0xa1,
    OP_IF_ICMPGE = 0xa2,
    OP_IF_ICMPGT = 0xa3,
    OP_IF_ICMPLE = 0xa4,
    OP_IF_ACMPEQ = 0xa5,
    OP_IF_ACMPNE = 0xa6,
    OP_GOTO = 0xa7,
    OP_JSR = 0xa8,
    OP_RET = 0xa9,
    OP_TABLESWITCH = 0xaa,
    OP_LOOKUPSWITCH = 0xab,
    OP_IRETURN = 0xac,
    OP_LRETURN = 0xad,
    OP_FRETURN = 0xae,
    OP_DRETURN = 0xaf,
    OP_ARETURN = 0xb0,
    OP_RETURN = 0xb1,
    OP_GETSTATIC = 0xb2,
    OP_PUTSTATIC = 0xb3,
    OP_GETFIELD = 0xb4,
    OP_PUTFIELD = 0xb5,
    OP_INVOKEVIRTUAL = 0xb6,
    OP_INVOKESPECIAL = 0xb7,
    OP_INVOKESTATIC = 0xb8,
    OP_INVOKEINTERFACE = 0xb9,
    OP_INVOKEDYNAMIC = 0xba,
    OP_NEW = 0xbb,
    OP_NEWARRAY = 0xbc,
    OP_ANEWARRAY = 0xbd,
    OP_ARRAYLENGTH = 0xbe,
    OP_ATHROW = 0xbf,
    OP_CHECKCAST = 0xc0,
    OP_INSTANCEOF = 0xc1,
    OP_MONITORENTER = 0xc2,
    OP_MONITOREXIT = 0xc3,
    OP_WIDE = 0xc4,
    OP_MULTIANEWARRAY = 0xc5,
    OP_IFNULL = 0xc6,
    OP_IFNONNULL = 0xc7,
    OP_GOTO_W = 0xc8,
    OP_JSR_W = 0xc9
};

// Helper to read u2
static uint16_t readU2(const uint8_t* p) {
    return (p[0] << 8) | p[1];
}

// Helper to read u4
static uint32_t readU4(const uint8_t* p) {
    return (p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3];
}

// Helper to write u2
static void writeU2(std::vector<uint8_t>& out, uint16_t v) {
    out.push_back((v >> 8) & 0xff);
    out.push_back(v & 0xff);
}

// Helper to write u4
static void writeU4(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back((v >> 24) & 0xff);
    out.push_back((v >> 16) & 0xff);
    out.push_back((v >> 8) & 0xff);
    out.push_back(v & 0xff);
}

bool ClassFile::parse(const uint8_t* data, size_t len) {
    if (len < 10) return false;
    
    size_t pos = 0;
    
    // Magic number
    magic_ = readU4(data + pos);
    if (magic_ != 0xCAFEBABE) {
        LOGE("Invalid class file magic: 0x%08X", magic_);
        return false;
    }
    pos += 4;
    
    // Version
    minor_version_ = readU2(data + pos);
    pos += 2;
    major_version_ = readU2(data + pos);
    pos += 2;
    
    // Constant pool
    constant_pool_count_ = readU2(data + pos);
    pos += 2;
    
    constant_pool_.clear();
    constant_pool_.resize(constant_pool_count_);
    
    // Index 0 is unused
    for (int i = 1; i < constant_pool_count_; i++) {
        if (pos >= len) {
            LOGE("Unexpected end of class file at constant pool %d", i);
            return false;
        }
        
        ConstantPoolEntry entry;
        entry.index = i;
        entry.tag = static_cast<ConstantTag>(data[pos]);
        pos++;
        
        switch (entry.tag) {
            case ConstantTag::CONSTANT_Utf8: {
                uint16_t length = readU2(data + pos);
                pos += 2;
                entry.data.assign(data + pos, data + pos + length);
                pos += length;
                break;
            }
            case ConstantTag::CONSTANT_Integer:
            case ConstantTag::CONSTANT_Float:
                entry.data.assign(data + pos, data + pos + 4);
                pos += 4;
                break;
            case ConstantTag::CONSTANT_Long:
            case ConstantTag::CONSTANT_Double:
                entry.data.assign(data + pos, data + pos + 8);
                pos += 8;
                i++; // Long and Double take two slots
                break;
            case ConstantTag::CONSTANT_Class:
            case ConstantTag::CONSTANT_String:
            case ConstantTag::CONSTANT_MethodType:
            case ConstantTag::CONSTANT_Module:
            case ConstantTag::CONSTANT_Package:
                entry.data.assign(data + pos, data + pos + 2);
                pos += 2;
                break;
            case ConstantTag::CONSTANT_Fieldref:
            case ConstantTag::CONSTANT_Methodref:
            case ConstantTag::CONSTANT_InterfaceMethodref:
            case ConstantTag::CONSTANT_NameAndType:
            case ConstantTag::CONSTANT_InvokeDynamic:
            case ConstantTag::CONSTANT_Dynamic:
                entry.data.assign(data + pos, data + pos + 4);
                pos += 4;
                break;
            case ConstantTag::CONSTANT_MethodHandle:
                entry.data.assign(data + pos, data + pos + 3);
                pos += 3;
                break;
            default:
                LOGE("Unknown constant pool tag: %d at index %d (pos %zu/%zu)", (int)entry.tag, i, pos, len);
                return false;
        }
        
        constant_pool_[i] = entry;
    }

    LOGI("Constant pool parsed: count=%d, pos=%zu/%zu", constant_pool_count_, pos, len);

    // Access flags
    access_flags_ = readU2(data + pos);
    pos += 2;
    
    // This class
    this_class_ = readU2(data + pos);
    pos += 2;
    
    // Super class
    super_class_ = readU2(data + pos);
    pos += 2;
    
    // Interfaces
    uint16_t interfaces_count = readU2(data + pos);
    pos += 2;
    interfaces_.clear();
    for (int i = 0; i < interfaces_count; i++) {
        interfaces_.push_back(readU2(data + pos));
        pos += 2;
    }
    
    // Fields
    uint16_t fields_count = readU2(data + pos);
    pos += 2;
    fields_.clear();
    fields_.resize(fields_count);
    for (int i = 0; i < fields_count; i++) {
        FieldInfo& field = fields_[i];
        field.access_flags = readU2(data + pos);
        pos += 2;
        field.name_index = readU2(data + pos);
        pos += 2;
        field.descriptor_index = readU2(data + pos);
        pos += 2;
        field.attributes_count = readU2(data + pos);
        pos += 2;
        
        size_t attrStart = pos;
        for (int j = 0; j < field.attributes_count; j++) {
            pos += 2;
            uint32_t attr_len = readU4(data + pos);
            pos += 4;
            pos += attr_len;
        }
        field.attributes.assign(data + attrStart, data + pos);
    }
    
    // Methods
    uint16_t methods_count = readU2(data + pos);
    pos += 2;
    methods_.clear();
    methods_.resize(methods_count);
    
    for (int i = 0; i < methods_count; i++) {
        MethodInfo& method = methods_[i];
        method.access_flags = readU2(data + pos);
        pos += 2;
        method.name_index = readU2(data + pos);
        pos += 2;
        method.descriptor_index = readU2(data + pos);
        pos += 2;
        uint16_t attributes_count = readU2(data + pos);
        pos += 2;
        
        for (int j = 0; j < attributes_count; j++) {
            size_t attr_start = pos;
            uint16_t attr_name_index = readU2(data + pos);
            pos += 2;
            uint32_t attr_len = readU4(data + pos);
            pos += 4;
            
            const char* attrName = getUtf8(attr_name_index);
            if (attrName && strcmp(attrName, "Code") == 0) {
                method.has_code = true;
                method.max_stack = readU2(data + pos);
                pos += 2;
                method.max_locals = readU2(data + pos);
                pos += 2;
                method.code_length = readU4(data + pos);
                pos += 4;
                
                method.code.assign(data + pos, data + pos + method.code_length);
                pos += method.code_length;
                
                size_t suffix_start = pos;
                uint16_t exception_table_length = readU2(data + pos);
                pos += 2;
                pos += exception_table_length * 8;
                
                uint16_t code_attr_count = readU2(data + pos);
                pos += 2;
                for (int k = 0; k < code_attr_count; k++) {
                    pos += 2;
                    uint32_t code_attr_len = readU4(data + pos);
                    pos += 4;
                    pos += code_attr_len;
                }
                method.code_suffix.assign(data + suffix_start, data + pos);
            } else {
                method.other_attributes_data.insert(
                    method.other_attributes_data.end(),
                    data + attr_start, data + pos + attr_len
                );
                method.other_attributes_count++;
                pos += attr_len;
            }
        }
    }
    
    // Remaining attributes
    if (pos > len) {
        LOGE("Parse overflow: pos=%zu > len=%zu after methods", pos, len);
        return false;
    }
    attributes_.assign(data + pos, data + len);

    LOGI("Parsed class file: version=%d.%d, constant_pool=%d, fields=%d, methods=%d, pos=%zu/%zu",
         major_version_, minor_version_, constant_pool_count_, (int)fields_.size(), (int)methods_.size(), pos, len);
    
    return true;
}

std::vector<uint8_t> ClassFile::build() {
    std::vector<uint8_t> out;
    
    // Magic
    writeU4(out, magic_);
    
    // Version
    writeU2(out, minor_version_);
    writeU2(out, major_version_);
    
    // Constant pool
    writeU2(out, constant_pool_count_);
    
    for (int i = 1; i < constant_pool_count_; i++) {
        ConstantPoolEntry& entry = constant_pool_[i];
        out.push_back(static_cast<uint8_t>(entry.tag));
        
        if (entry.tag == ConstantTag::CONSTANT_Utf8) {
            writeU2(out, entry.data.size());
        }
        
        out.insert(out.end(), entry.data.begin(), entry.data.end());
        
        if (entry.tag == ConstantTag::CONSTANT_Long || 
            entry.tag == ConstantTag::CONSTANT_Double) {
            i++;
        }
    }
    
    // Access flags
    writeU2(out, access_flags_);
    
    // This class
    writeU2(out, this_class_);
    
    // Super class
    writeU2(out, super_class_);
    
    // Interfaces
    writeU2(out, interfaces_.size());
    for (uint16_t iface : interfaces_) {
        writeU2(out, iface);
    }
    
    // Fields
    writeU2(out, fields_.size());
    for (const FieldInfo& field : fields_) {
        writeU2(out, field.access_flags);
        writeU2(out, field.name_index);
        writeU2(out, field.descriptor_index);
        writeU2(out, field.attributes_count);
        out.insert(out.end(), field.attributes.begin(), field.attributes.end());
    }
    
    // Methods
    writeU2(out, methods_.size());
    for (const MethodInfo& method : methods_) {
        writeU2(out, method.access_flags);
        writeU2(out, method.name_index);
        writeU2(out, method.descriptor_index);
        
        uint16_t total_attrs = (method.has_code ? 1 : 0) + method.other_attributes_count;
        writeU2(out, total_attrs);
        
        if (method.has_code) {
            int codeNameIdx = findUtf8("Code");
            if (codeNameIdx <= 0) {
                codeNameIdx = addUtf8("Code");
            }
            writeU2(out, codeNameIdx);
            
            uint32_t codeAttrLen = 2 + 2 + 4 + method.code.size() + method.code_suffix.size();
            writeU4(out, codeAttrLen);
            
            writeU2(out, method.max_stack);
            writeU2(out, method.max_locals);
            writeU4(out, method.code.size());
            out.insert(out.end(), method.code.begin(), method.code.end());
            
            out.insert(out.end(), method.code_suffix.begin(), method.code_suffix.end());
        }
        
        if (method.other_attributes_count > 0) {
            out.insert(out.end(), method.other_attributes_data.begin(), method.other_attributes_data.end());
        }
    }
    
    // Class attributes
    out.insert(out.end(), attributes_.begin(), attributes_.end());
    
    return out;
}

int ClassFile::findUtf8(const std::string& str) {
    for (int i = 1; i < constant_pool_count_; i++) {
        if (constant_pool_[i].tag == ConstantTag::CONSTANT_Utf8) {
            std::string s((const char*)constant_pool_[i].data.data(), 
                          constant_pool_[i].data.size());
            if (s == str) return i;
        }
    }
    return -1;
}

int ClassFile::findClass(const std::string& className) {
    int nameIdx = findUtf8(className);
    if (nameIdx < 0) return -1;
    
    for (int i = 1; i < constant_pool_count_; i++) {
        if (constant_pool_[i].tag == ConstantTag::CONSTANT_Class) {
            uint16_t idx = readU2(constant_pool_[i].data.data());
            if (idx == nameIdx) return i;
        }
    }
    return -1;
}

const char* ClassFile::getUtf8(uint16_t index) {
    if (index < 1 || index >= constant_pool_count_) return nullptr;
    if (constant_pool_[index].tag != ConstantTag::CONSTANT_Utf8) return nullptr;
    return (const char*)constant_pool_[index].data.data();
}

uint16_t ClassFile::addUtf8(const std::string& str) {
    int existing = findUtf8(str);
    if (existing > 0) return existing;
    
    uint16_t index = constant_pool_count_;
    constant_pool_count_++;
    
    ConstantPoolEntry entry;
    entry.index = index;
    entry.tag = ConstantTag::CONSTANT_Utf8;
    entry.data.assign(str.begin(), str.end());
    
    constant_pool_.push_back(entry);
    return index;
}

uint16_t ClassFile::addClass(const std::string& className) {
    int existing = findClass(className);
    if (existing > 0) return existing;
    
    uint16_t nameIdx = addUtf8(className);
    uint16_t index = constant_pool_count_;
    constant_pool_count_++;
    
    ConstantPoolEntry entry;
    entry.index = index;
    entry.tag = ConstantTag::CONSTANT_Class;
    entry.data.resize(2);
    entry.data[0] = (nameIdx >> 8) & 0xff;
    entry.data[1] = nameIdx & 0xff;
    
    constant_pool_.push_back(entry);
    return index;
}

uint16_t ClassFile::addNameAndType(const std::string& name, const std::string& descriptor) {
    uint16_t nameIdx = addUtf8(name);
    uint16_t descIdx = addUtf8(descriptor);
    
    // Check if already exists
    for (int i = 1; i < constant_pool_count_; i++) {
        if (constant_pool_[i].tag == ConstantTag::CONSTANT_NameAndType) {
            uint16_t n = readU2(constant_pool_[i].data.data());
            uint16_t d = readU2(constant_pool_[i].data.data() + 2);
            if (n == nameIdx && d == descIdx) return i;
        }
    }
    
    uint16_t index = constant_pool_count_;
    constant_pool_count_++;
    
    ConstantPoolEntry entry;
    entry.index = index;
    entry.tag = ConstantTag::CONSTANT_NameAndType;
    entry.data.resize(4);
    entry.data[0] = (nameIdx >> 8) & 0xff;
    entry.data[1] = nameIdx & 0xff;
    entry.data[2] = (descIdx >> 8) & 0xff;
    entry.data[3] = descIdx & 0xff;
    
    constant_pool_.push_back(entry);
    return index;
}

uint16_t ClassFile::addMethodref(const std::string& className, const std::string& name, 
                                  const std::string& descriptor) {
    uint16_t classIdx = addClass(className);
    uint16_t natIdx = addNameAndType(name, descriptor);
    
    // Check if already exists
    for (int i = 1; i < constant_pool_count_; i++) {
        if (constant_pool_[i].tag == ConstantTag::CONSTANT_Methodref) {
            uint16_t c = readU2(constant_pool_[i].data.data());
            uint16_t n = readU2(constant_pool_[i].data.data() + 2);
            if (c == classIdx && n == natIdx) return i;
        }
    }
    
    uint16_t index = constant_pool_count_;
    constant_pool_count_++;
    
    ConstantPoolEntry entry;
    entry.index = index;
    entry.tag = ConstantTag::CONSTANT_Methodref;
    entry.data.resize(4);
    entry.data[0] = (classIdx >> 8) & 0xff;
    entry.data[1] = classIdx & 0xff;
    entry.data[2] = (natIdx >> 8) & 0xff;
    entry.data[3] = natIdx & 0xff;
    
    constant_pool_.push_back(entry);
    return index;
}

uint16_t ClassFile::addFieldref(const std::string& className, const std::string& name, 
                                 const std::string& descriptor) {
    uint16_t classIdx = addClass(className);
    uint16_t natIdx = addNameAndType(name, descriptor);
    
    uint16_t index = constant_pool_count_;
    constant_pool_count_++;
    
    ConstantPoolEntry entry;
    entry.index = index;
    entry.tag = ConstantTag::CONSTANT_Fieldref;
    entry.data.resize(4);
    entry.data[0] = (classIdx >> 8) & 0xff;
    entry.data[1] = classIdx & 0xff;
    entry.data[2] = (natIdx >> 8) & 0xff;
    entry.data[3] = natIdx & 0xff;
    
    constant_pool_.push_back(entry);
    return index;
}

uint16_t ClassFile::addString(const std::string& str) {
    uint16_t utf8Idx = addUtf8(str);
    
    // Check if already exists
    for (int i = 1; i < constant_pool_count_; i++) {
        if (constant_pool_[i].tag == ConstantTag::CONSTANT_String) {
            uint16_t idx = readU2(constant_pool_[i].data.data());
            if (idx == utf8Idx) return i;
        }
    }
    
    uint16_t index = constant_pool_count_;
    constant_pool_count_++;
    
    ConstantPoolEntry entry;
    entry.index = index;
    entry.tag = ConstantTag::CONSTANT_String;
    entry.data.resize(2);
    entry.data[0] = (utf8Idx >> 8) & 0xff;
    entry.data[1] = utf8Idx & 0xff;
    
    constant_pool_.push_back(entry);
    return index;
}

uint16_t ClassFile::addInteger(int32_t value) {
    uint16_t index = constant_pool_count_;
    constant_pool_count_++;
    
    ConstantPoolEntry entry;
    entry.index = index;
    entry.tag = ConstantTag::CONSTANT_Integer;
    entry.data.resize(4);
    entry.data[0] = (value >> 24) & 0xff;
    entry.data[1] = (value >> 16) & 0xff;
    entry.data[2] = (value >> 8) & 0xff;
    entry.data[3] = value & 0xff;
    
    constant_pool_.push_back(entry);
    return index;
}

int ClassFile::findMethod(const std::string& name, const std::string& descriptor) {
    int nameIdx = findUtf8(name);
    int descIdx = findUtf8(descriptor);
    if (nameIdx < 0 || descIdx < 0) return -1;
    
    for (int i = 0; i < (int)methods_.size(); i++) {
        if (methods_[i].name_index == nameIdx && 
            methods_[i].descriptor_index == descIdx) {
            return i;
        }
    }
    return -1;
}

bool ClassFile::injectMethodCall(int methodIndex, const std::string& className,
                                  const std::string& methodName, const std::string& methodDesc,
                                  bool atEntry, bool captureResult) {
    if (methodIndex < 0 || methodIndex >= (int)methods_.size()) return false;
    
    MethodInfo& method = methods_[methodIndex];
    if (method.code.empty()) return false;
    
    // Add method reference
    uint16_t methodrefIdx = addMethodref(className, methodName, methodDesc);
    
    // Generate INVOKESTATIC instruction
    std::vector<uint8_t> callBytes;
    callBytes.push_back(OP_INVOKESTATIC);
    callBytes.push_back((methodrefIdx >> 8) & 0xff);
    callBytes.push_back(methodrefIdx & 0xff);
    
    if (atEntry) {
        // Insert at the beginning
        method.code.insert(method.code.begin(), callBytes.begin(), callBytes.end());
        method.code_length = method.code.size();
        method.max_stack += 1;
        LOGI("Injected call at entry of method");
    }
    
    return true;
}

void ClassFile::dumpInfo() {
    LOGI("=== Class File Info ===");
    LOGI("Magic: 0x%08X", magic_);
    LOGI("Version: %d.%d", major_version_, minor_version_);
    LOGI("Constant pool count: %d", constant_pool_count_);
    
    const char* className = getUtf8(this_class_);
    if (className) {
        uint16_t nameIdx = readU2(constant_pool_[this_class_].data.data());
        const char* realName = getUtf8(nameIdx);
        LOGI("Class name: %s", realName ? realName : "unknown");
    }
    
    LOGI("Methods:");
    for (size_t i = 0; i < methods_.size(); i++) {
        const char* name = getUtf8(methods_[i].name_index);
        const char* desc = getUtf8(methods_[i].descriptor_index);
        LOGI("  [%zu] %s%s (code_len=%d)", i, name ? name : "?", desc ? desc : "?", 
             (int)methods_[i].code.size());
    }
}

// BytecodeInjector implementation
std::vector<uint8_t> BytecodeInjector::generateStaticCall(uint16_t methodrefIndex) {
    std::vector<uint8_t> code;
    code.push_back(OP_INVOKESTATIC);
    code.push_back((methodrefIndex >> 8) & 0xff);
    code.push_back(methodrefIndex & 0xff);
    return code;
}

std::vector<uint8_t> BytecodeInjector::generateLoadLocal(int slot, const std::string& type) {
    std::vector<uint8_t> code;
    
    if (type == "I" || type == "Z" || type == "B" || type == "C" || type == "S") {
        if (slot == 0) code.push_back(OP_ILOAD_0);
        else if (slot == 1) code.push_back(OP_ILOAD_1);
        else if (slot == 2) code.push_back(OP_ILOAD_2);
        else if (slot == 3) code.push_back(OP_ILOAD_3);
        else {
            code.push_back(OP_ILOAD);
            code.push_back(slot);
        }
    } else if (type == "J") {
        if (slot == 0) code.push_back(OP_LLOAD_0);
        else if (slot == 1) code.push_back(OP_LLOAD_1);
        else {
            code.push_back(OP_LLOAD);
            code.push_back(slot);
        }
    } else if (type == "F") {
        if (slot == 0) code.push_back(OP_FLOAD_0);
        else {
            code.push_back(OP_FLOAD);
            code.push_back(slot);
        }
    } else {
        // Object reference
        if (slot == 0) code.push_back(OP_ALOAD_0);
        else if (slot == 1) code.push_back(OP_ALOAD_1);
        else if (slot == 2) code.push_back(OP_ALOAD_2);
        else if (slot == 3) code.push_back(OP_ALOAD_3);
        else {
            code.push_back(OP_ALOAD);
            code.push_back(slot);
        }
    }
    
    return code;
}

std::vector<uint8_t> BytecodeInjector::generateStoreLocal(int slot, const std::string& type) {
    std::vector<uint8_t> code;
    
    if (type == "I" || type == "Z" || type == "B" || type == "C" || type == "S") {
        if (slot == 0) code.push_back(OP_ISTORE_0);
        else if (slot == 1) code.push_back(OP_ISTORE_1);
        else if (slot == 2) code.push_back(OP_ISTORE_2);
        else if (slot == 3) code.push_back(OP_ISTORE_3);
        else {
            code.push_back(OP_ISTORE);
            code.push_back(slot);
        }
    } else if (type == "J") {
        if (slot == 0) code.push_back(OP_LSTORE_0);
        else if (slot == 1) code.push_back(OP_LSTORE_1);
        else {
            code.push_back(OP_LSTORE);
            code.push_back(slot);
        }
    } else {
        // Object reference
        if (slot == 0) code.push_back(OP_ASTORE_0);
        else if (slot == 1) code.push_back(OP_ASTORE_1);
        else if (slot == 2) code.push_back(OP_ASTORE_2);
        else if (slot == 3) code.push_back(OP_ASTORE_3);
        else {
            code.push_back(OP_ASTORE);
            code.push_back(slot);
        }
    }
    
    return code;
}

}