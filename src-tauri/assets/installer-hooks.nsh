; VaultMate installer hooks
; Redefines LICENSE so the bundler-generated template activates the license page.
; This file is !include'd by tauri-bundler before the page declarations.

!ifdef LICENSE
  !undef LICENSE
!endif
!define LICENSE "${__FILEDIR__}\..\assets\license.rtf"
