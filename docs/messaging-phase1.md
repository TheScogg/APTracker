# Messaging Phase 1 (Implementation Draft)

This phase adds the first implementation pieces for plant-scoped conversations:

- Firestore security rules for `conversations`, `messages`, and per-conversation `members`.
- Composite indexes for common conversation list queries.
- Front-end Firestore helpers and global functions to create/listen/send/read conversation data.

## Global functions added in `app.js`

- `createConversation({ type, title, memberIds, pressId })`
- `watchConversations(onConversations, { type })`
- `openConversation(conversationId, onMessages)`
- `sendConversationMessage(conversationId, text, { mentions })`
- `markConversationRead(conversationId, lastReadMessageId)`
- `closeConversation()`
- `closeConversationList()`

## Notes

- Phase 1.1 now includes a minimal messaging modal UI (conversation list + thread + composer) wired to the conversation APIs.
- Existing Press Notes continue to work unchanged.
- APIs are exposed on `window` to support progressive UI wiring.
- DM creation dedupes existing active 1:1 conversations for the same two users.
- Conversation + member docs are created in a single batch write for atomic setup.
