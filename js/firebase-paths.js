import { collection, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function createFirebasePathHelpers({
  db,
  getPlantId,
  getUserId,
  getLeaderboardPeriod,
  wikiScopeShared = 'shared'
}) {
  const plantId = () => getPlantId();
  const userId = () => getUserId();
  const plantBase = () => ['plants', plantId()];
  const plantCollectionPath = colName => [...plantBase(), colName];

  function wikiCollectionPath(scope, pressId) {
    return scope === wikiScopeShared
      ? [...plantBase(), 'wikiPages']
      : [...plantBase(), 'presses', String(pressId), 'wikiPages'];
  }

  return {
    plantCol(colName) {
      return collection(db, ...plantCollectionPath(colName));
    },
    plantDoc(colName, docId) {
      return doc(db, ...plantCollectionPath(colName), docId);
    },
    issueEventsCol(issueId) {
      return collection(db, ...plantCollectionPath('issues'), issueId, 'events');
    },
    issueAttachmentsCol(issueId) {
      return collection(db, ...plantCollectionPath('issues'), issueId, 'attachments');
    },
    pressWikiPagesCol(pressId) {
      return collection(db, ...plantBase(), 'presses', String(pressId), 'wikiPages');
    },
    pressWikiPageDoc(pressId, pageId) {
      return doc(db, ...plantBase(), 'presses', String(pressId), 'wikiPages', pageId);
    },
    pressWikiRevisionsCol(pressId, pageId) {
      return collection(db, ...plantBase(), 'presses', String(pressId), 'wikiPages', pageId, 'revisions');
    },
    pressWikiAttachmentsCol(pressId, pageId) {
      return collection(db, ...plantBase(), 'presses', String(pressId), 'wikiPages', pageId, 'attachments');
    },
    wikiCollectionPath,
    wikiPagesColForScope(scope, pressId) {
      return collection(db, ...wikiCollectionPath(scope, pressId));
    },
    wikiPageDocForScope(scope, pressId, pageId) {
      return doc(db, ...wikiCollectionPath(scope, pressId), pageId);
    },
    wikiRevisionsColForScope(scope, pressId, pageId) {
      return collection(db, ...wikiCollectionPath(scope, pressId), pageId, 'revisions');
    },
    wikiAttachmentsColForScope(scope, pressId, pageId) {
      return collection(db, ...wikiCollectionPath(scope, pressId), pageId, 'attachments');
    },
    wikiStoragePrefixForScope(scope, pressId, pageId) {
      return scope === wikiScopeShared
        ? `plants/${plantId()}/wikiPages/${pageId}`
        : `plants/${plantId()}/presses/${String(pressId)}/wikiPages/${pageId}`;
    },
    notesCol() {
      return collection(db, ...plantCollectionPath('notes'));
    },
    noteDoc(noteId) {
      return doc(db, ...plantCollectionPath('notes'), noteId);
    },
    noteAttachmentsCol(noteId) {
      return collection(db, ...plantCollectionPath('notes'), noteId, 'attachments');
    },
    noteStoragePrefix(noteId) {
      return `plants/${plantId()}/notes/${noteId}`;
    },
    plantTodosCol() {
      return collection(db, ...plantCollectionPath('todos'));
    },
    plantTodoDoc(todoId) {
      return doc(db, ...plantCollectionPath('todos'), todoId);
    },
    userTodosCol() {
      return collection(db, 'users', userId(), 'todos');
    },
    userTodoDoc(todoId) {
      return doc(db, 'users', userId(), 'todos', todoId);
    },
    plantMemberDocRef(targetPlantId, targetUserId) {
      return doc(db, 'plants', targetPlantId, 'members', targetUserId);
    },
    gameConfigDoc() {
      return doc(db, ...plantBase(), 'gamificationConfig', 'main');
    },
    gameUserStatsDoc(targetUserId) {
      return doc(db, ...plantBase(), 'userGameStats', targetUserId);
    },
    gameMissionsCol() {
      return collection(db, ...plantBase(), 'missions');
    },
    gameLeaderboardDoc(boardId) {
      return doc(db, ...plantBase(), 'leaderboards', boardId || getLeaderboardPeriod() || 'weekly');
    },
    userBadgesDoc(targetUserId) {
      return doc(db, ...plantBase(), 'userBadges', targetUserId);
    },
    gameEventsCol() {
      return collection(db, ...plantBase(), 'gameEvents');
    },
    missionProgressDoc(missionId, subjectId) {
      return doc(db, ...plantBase(), 'missions', missionId, 'progress', subjectId);
    },
    globalStoreConfigDoc() {
      return doc(db, 'globalConfig', 'store');
    },
    legacyPlantStoreConfigDoc() {
      return doc(db, ...plantBase(), 'config', 'store');
    },
    conversationsCol() {
      return collection(db, ...plantBase(), 'conversations');
    },
    conversationDoc(conversationId) {
      return doc(db, ...plantBase(), 'conversations', conversationId);
    },
    conversationMessagesCol(conversationId) {
      return collection(db, ...plantBase(), 'conversations', conversationId, 'messages');
    },
    conversationMemberDoc(conversationId, targetUserId) {
      return doc(db, ...plantBase(), 'conversations', conversationId, 'members', targetUserId);
    }
  };
}
