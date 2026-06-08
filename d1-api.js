import {
  serializeGamificationConfig,
  serializeIssue,
  serializeIssueAttachment,
  serializeIssueEvent,
  serializePlant,
  serializePlantMember,
  serializePressConfig,
  serializeStatusConfig,
  serializeUserContextRows
} from './api/src/serializers.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

function errorResponse(error) {
  const status = error?.status || 500;
  return jsonResponse({
    error: status === 500 ? 'Internal server error' : (error?.message || 'Unknown error')
  }, { status });
}

function getDb(env) {
  const db = env.APTRACKER_DB || env.DB;
  if (!db) {
    throw Object.assign(new Error('D1 binding not configured. Add APTRACKER_DB or DB to wrangler.jsonc.'), { status: 500 });
  }
  return db;
}

function decodePathSegment(value) {
  return decodeURIComponent(String(value || ''));
}

function normalizeAuthUser(user) {
  if (!user?.localId) {
    throw Object.assign(new Error('Invalid Firebase user context.'), { status: 401 });
  }
  return {
    uid: user.localId,
    email: user.email || '',
    name: user.displayName || user.email || user.localId,
    picture: user.photoUrl || ''
  };
}

function parsePermissions(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function all(db, sql, ...params) {
  const result = await db.prepare(sql).bind(...params).all();
  return result.results || [];
}

async function first(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function requirePlantPermission(db, plantId, user, permissionName) {
  const member = await first(
    db,
    `
      SELECT role, is_active, permissions_json
      FROM plant_members
      WHERE plant_id = ? AND uid = ?
      LIMIT 1
    `,
    plantId,
    user.uid
  );
  if (!member || !Number(member.is_active)) {
    throw Object.assign(new Error('Plant access denied'), { status: 403 });
  }
  if (permissionName) {
    const permissions = parsePermissions(member.permissions_json);
    if (permissions[permissionName] !== true) {
      throw Object.assign(new Error('Permission denied'), { status: 403 });
    }
  }
  return member;
}

async function getCurrentUserContext(db, user) {
  const rows = await all(
    db,
    `
      SELECT
        u.uid,
        u.email,
        u.display_name,
        u.photo_url,
        u.last_plant_id,
        pm.plant_id,
        pm.role,
        pm.is_active,
        pm.permissions_json,
        p.name AS plant_name
      FROM users u
      LEFT JOIN plant_members pm ON pm.uid = u.uid AND pm.is_active = 1
      LEFT JOIN plants p ON p.plant_id = pm.plant_id
      WHERE u.uid = ?
      ORDER BY p.name COLLATE NOCASE
    `,
    user.uid
  );
  return jsonResponse({
    auth: user,
    ...serializeUserContextRows(rows)
  });
}

async function getPlantBootstrap(db, plantId, user) {
  const member = await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const [plant, statuses, presses, game] = await Promise.all([
    first(db, 'SELECT * FROM plants WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM plant_status_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM plant_press_config WHERE plant_id = ? LIMIT 1', plantId),
    first(db, 'SELECT * FROM gamification_config WHERE plant_id = ? LIMIT 1', plantId)
  ]);
  return jsonResponse({
    plant: serializePlant(plant),
    member: serializePlantMember(member),
    statusConfig: serializeStatusConfig(statuses),
    pressConfig: serializePressConfig(presses),
    gamificationConfig: serializeGamificationConfig(game)
  });
}

async function listIssues(db, request, plantId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 250));
  const issues = await all(
    db,
    `
      SELECT *
      FROM issues
      WHERE plant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    plantId,
    limit
  );
  return jsonResponse({ issues: issues.map(serializeIssue) });
}

async function getIssue(db, plantId, issueId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const issue = await first(
    db,
    `
      SELECT *
      FROM issues
      WHERE plant_id = ? AND issue_id = ?
      LIMIT 1
    `,
    plantId,
    issueId
  );
  if (!issue) {
    return jsonResponse({ error: 'Issue not found' }, { status: 404 });
  }
  return jsonResponse({ issue: serializeIssue(issue) });
}

async function listIssueEvents(db, plantId, issueId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const events = await all(
    db,
    `
      SELECT *
      FROM issue_events
      WHERE plant_id = ? AND issue_id = ?
      ORDER BY event_at ASC, created_at ASC
    `,
    plantId,
    issueId
  );
  return jsonResponse({ events: events.map(serializeIssueEvent) });
}

async function listIssueAttachments(db, plantId, issueId, user) {
  await requirePlantPermission(db, plantId, user, 'canViewPlant');
  const attachments = await all(
    db,
    `
      SELECT *
      FROM issue_attachments
      WHERE plant_id = ? AND issue_id = ?
      ORDER BY uploaded_at DESC
    `,
    plantId,
    issueId
  );
  return jsonResponse({ attachments: attachments.map(serializeIssueAttachment) });
}

export async function handleD1ApiRequest(request, env, { authenticateRequest } = {}) {
  const url = new URL(request.url);
  const db = getDb(env);

  try {
    const meMatch = request.method === 'GET' && url.pathname === '/api/me';
    const bootstrapMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/bootstrap$/);
    const issuesMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues$/);
    const issueMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)$/);
    const eventsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/events$/);
    const attachmentsMatch = request.method === 'GET' && url.pathname.match(/^\/api\/plants\/([^/]+)\/issues\/([^/]+)\/attachments$/);

    if (!meMatch && !bootstrapMatch && !issuesMatch && !issueMatch && !eventsMatch && !attachmentsMatch) {
      return null;
    }

    if (typeof authenticateRequest !== 'function') {
      throw Object.assign(new Error('D1 API authentication handler is not configured.'), { status: 500 });
    }
    const user = normalizeAuthUser(await authenticateRequest(request, env));

    if (meMatch) {
      return getCurrentUserContext(db, user);
    }
    if (bootstrapMatch) {
      return getPlantBootstrap(db, decodePathSegment(bootstrapMatch[1]), user);
    }
    if (issuesMatch) {
      return listIssues(db, request, decodePathSegment(issuesMatch[1]), user);
    }
    if (issueMatch) {
      return getIssue(db, decodePathSegment(issueMatch[1]), decodePathSegment(issueMatch[2]), user);
    }
    if (eventsMatch) {
      return listIssueEvents(db, decodePathSegment(eventsMatch[1]), decodePathSegment(eventsMatch[2]), user);
    }
    if (attachmentsMatch) {
      return listIssueAttachments(db, decodePathSegment(attachmentsMatch[1]), decodePathSegment(attachmentsMatch[2]), user);
    }
    return null;
  } catch (error) {
    return errorResponse(error);
  }
}
