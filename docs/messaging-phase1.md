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
- Messaging modal includes a `+ New DM` action (prompt-based member picker) so users can create a conversation before sending.
- Messaging modal includes `+ New Group` (prompt-based title + member picker) for basic group messaging creation.
<<<<<<< codex/find-google-integration-for-messaging-ns4p9f
- Recipient selection now uses dropdowns (DM single-select and group multi-select checkboxes) instead of numeric prompts.
=======
>>>>>>> main
- Existing Press Notes continue to work unchanged.
- APIs are exposed on `window` to support progressive UI wiring.
- DM creation dedupes existing active 1:1 conversations for the same two users.
- Conversation + member docs are created in a single batch write for atomic setup.
- Rules support same-batch conversation bootstrap (using before/after doc checks) so DM creation can create conversation + members in one commit.
- Conversation read access supports both member docs and `conversation.memberIds` to avoid list-listener permission failures during member-doc lag/recovery.
<<<<<<< codex/find-google-integration-for-messaging-ns4p9f
- Messaging UI supports conversation sorting (`Most Recent` or `Name`), browser/in-app notifications for incoming messages, and photo attachments (image upload to Firebase Storage + message attachment render).
=======
>>>>>>> main
