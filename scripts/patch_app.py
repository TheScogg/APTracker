import re

with open('app.js', 'r') as f:
    content = f.read()

# 1. Remove NOTES_VARIANT and related variables (but KEEP wiki variables)
content = re.sub(r"const NOTES_VARIANT = 'a';\s*let _notesUnsubscribe = null;\s*let _notesModalPressId = null;\s*let _notesModalMachineCode = null;\s*let pendingPressNotePhotos = \[\];", "", content)

content = re.sub(r"function _nid\(base\).*?\n", "", content)
content = re.sub(r"function _notesModalEl\(\).*?\n", "", content)
content = re.sub(r"function _notesEl\(\).*?\n", "", content)

# 2. Add _pressWikiMachineCode
content = re.sub(r"let _pressWikiAttachmentsCache = \[\];", "let _pressWikiAttachmentsCache = [];\nlet _pressWikiMachineCode = null;", content)

# 3. Remove _notesPressStats to _renderPressNotePhotoThumbs
content = re.sub(r"function _notesPressStats.*?function openPressWikiModal", "function openPressWikiModal", content, flags=re.DOTALL)

# 4. Update openPressWikiModal signature
content = re.sub(r"async function openPressWikiModal\(\) \{", "async function openPressWikiModal(pressId, machineCode) {", content)

# 5. Fix references inside openPressWikiModal
content = re.sub(r"if \(!_notesModalPressId \|\| !currentPlantId\) return;", "if (!pressId || !currentPlantId) return;", content)
content = re.sub(r"_pressWikiModalPressId = String\(_notesModalPressId\);", "_pressWikiModalPressId = String(pressId);\n  _pressWikiMachineCode = String(machineCode || '').trim();", content)
content = re.sub(r"_notesModalMachineCode", "_pressWikiMachineCode", content)

# 6. Remove window.openNotesModal ... to window.submitPressNote and deletePressNote
content = re.sub(r"window\.openNotesModal =.*?// Allow Enter to submit", "// Allow Enter to submit", content, flags=re.DOTALL)

# 7. Remove the event listeners array for 'a' and 'b' variants
content = re.sub(r"// Allow Enter to submit.*?\}\);", "", content, flags=re.DOTALL)

# 8. Replace all openNotesModal calls with openPressWikiModal
content = content.replace("openNotesModal(", "openPressWikiModal(")

with open('app.js', 'w') as f:
    f.write(content)

