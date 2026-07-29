import { app } from '@azure/functions';
import {
  getCurrentUserContext,
  getIssue,
  getPlantBootstrap,
  listIssueAttachments,
  listIssueEvents,
  listIssues
} from './routes.js';

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: getCurrentUserContext
});

app.http('plantBootstrap', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'plants/{plantId}/bootstrap',
  handler: getPlantBootstrap
});

app.http('plantIssues', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'plants/{plantId}/issues',
  handler: listIssues
});

app.http('plantIssue', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'plants/{plantId}/issues/{issueId}',
  handler: getIssue
});

app.http('plantIssueEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'plants/{plantId}/issues/{issueId}/events',
  handler: listIssueEvents
});

app.http('plantIssueAttachments', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'plants/{plantId}/issues/{issueId}/attachments',
  handler: listIssueAttachments
});
