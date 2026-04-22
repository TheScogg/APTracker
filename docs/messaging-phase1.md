# Messaging Phase 1 (Implementation Draft)

This phase adds the first implementation pieces for plant-scoped conversations:

- Firestore security rules for `conversations`, `messages`, and per-conversation `members`.
- Composite indexes for common conversation list queries.
- Front-end Firestore helpers and global functions to create/listen/send/read conversation data.

## Global functions added in `app.js`

- `createConversation({ type, title, memberIds, pressId })`
- `openConversation(conversationId, onMessages)`
- `sendConversationMessage(conversationId, text, { mentions })`
- `markConversationRead(conversationId, lastReadMessageId)`
- `closeConversation()`

## Notes

- This phase intentionally does not yet add a dedicated chat UI.
- Existing Press Notes continue to work unchanged.
- APIs are exposed on `window` to support progressive UI wiring.
