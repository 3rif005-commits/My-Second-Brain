cmake_minimum_required(VERSION 3.22)
project(llama_jni)

set(CMAKE_CXX_STANDARD 17)

# Prebuilt llama.cpp shared libs live in jniLibs/<ABI>
set(JNILIB_DIR ${CMAKE_SOURCE_DIR}/../jniLibs/${ANDROID_ABI})

add_library(llama      SHARED IMPORTED)
set_target_properties(llama      PROPERTIES IMPORTED_LOCATION ${JNILIB_DIR}/libllama.so)

add_library(ggml       SHARED IMPORTED)
set_target_properties(ggml       PROPERTIES IMPORTED_LOCATION ${JNILIB_DIR}/libggml.so)

add_library(ggml-base  SHARED IMPORTED)
set_target_properties(ggml-base  PROPERTIES IMPORTED_LOCATION ${JNILIB_DIR}/libggml-base.so)

add_library(ggml-cpu   SHARED IMPORTED)
set_target_properties(ggml-cpu   PROPERTIES IMPORTED_LOCATION ${JNILIB_DIR}/libggml-cpu.so)

# GPU backends (Vulkan / OpenCL) disabled on this Adreno 710 device:
#   - Vulkan crashes at vkCmdBindPipeline for Q4_K matmul (32 KB SLM ceiling)
#   - OpenCL works but destabilizes the system UI (unified memory contention)
# To re-enable OpenCL later: rebuild libggml-opencl.so, drop in jniLibs/,
# add `add_library(ggml-opencl SHARED IMPORTED) + set_target_properties + target_link_libraries`.

# Our thin JNI bridge
add_library(llama_jni SHARED llama_jni.cpp)

target_include_directories(llama_jni PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(llama_jni llama ggml ggml-base ggml-cpu log android)
