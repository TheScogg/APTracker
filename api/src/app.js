import { app } from '@azure/functions';
import { getCurrentUserContext, getPlantBootstrap, listIssues } from './routes.js';

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
