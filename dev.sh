#!/usr/bin/env bash
MSVC_VER="14.44.35207"
SDK_VER="10.0.26100.0"
VS_BASE="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools"

export PATH="/c/Users/Bittu/.cargo/bin:${VS_BASE}/VC/Tools/MSVC/${MSVC_VER}/bin/Hostx64/x64:$PATH"
export LIB="${VS_BASE}/VC/Tools/MSVC/${MSVC_VER}/lib/x64;/c/Program Files (x86)/Windows Kits/10/Lib/${SDK_VER}/um/x64;/c/Program Files (x86)/Windows Kits/10/Lib/${SDK_VER}/ucrt/x64"
export INCLUDE="${VS_BASE}/VC/Tools/MSVC/${MSVC_VER}/include;/c/Program Files (x86)/Windows Kits/10/Include/${SDK_VER}/ucrt;/c/Program Files (x86)/Windows Kits/10/Include/${SDK_VER}/um;/c/Program Files (x86)/Windows Kits/10/Include/${SDK_VER}/shared"

cd "s:/Project Management/vaultmate"
npm run tauri dev
