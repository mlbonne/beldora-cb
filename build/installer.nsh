; Beldora CB installer customisations.
; - Default install folder is C:\Users\<you>\Beldora CB (not AppData): the app keeps saves, PDFs and images there.
; - Updating or uninstalling removes only the program; the user's folders stay unless they ask otherwise.

!macro preInit
  ; Keep an existing location, unless it is the old AppData one
  SetRegView 64
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  SetRegView 32
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  StrCpy $1 "0"
  ${If} $0 == ""
    StrCpy $1 "1"
  ${Else}
    ; Previous versions installed under AppData: move to the new default
    StrLen $3 "$LOCALAPPDATA"
    StrCpy $2 $0 $3
    ${If} $2 == "$LOCALAPPDATA"
      StrCpy $1 "1"
    ${EndIf}
    StrLen $3 "$APPDATA"
    StrCpy $2 $0 $3
    ${If} $2 == "$APPDATA"
      StrCpy $1 "1"
    ${EndIf}
  ${EndIf}
  ${If} $1 == "1"
    SetRegView 64
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROFILE\Beldora CB"
    SetRegView 32
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROFILE\Beldora CB"
  ${EndIf}
!macroend

!macro customRemoveFiles
  SetOutPath $TEMP
  ; Program files only. Saves, Exports, images, 5etools and System are the user's.
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\Updates"
  RMDir /r "$INSTDIR\5etools-next"
  Delete "$INSTDIR\*.*"
  ${IfNot} ${isUpdated}
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Beldora CB was removed.$\r$\n$\r$\nAlso delete your saved characters, exported PDFs, downloaded images and 5etools updates in:$\r$\n$INSTDIR ?" IDNO +2
        RMDir /r "$INSTDIR"
    ${EndIf}
    ; Removes the folder only if nothing is left in it
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
