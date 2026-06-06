import { authenticateRequest } from './auth.js';
import { getPool, sql } from './db.js';
import { errorResponse, json } from './http.js';
import { requirePlantPermission } from './permissions.js';
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
} from './serializers.js';

export async function getCurrentUserContext(request) {
  try {
    const user = await authenticateRequest(request);
    const pool = await getPool();
    const result = await pool.request()
      .input('uid', sql.NVarChar(128), user.uid)
      .query(`
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
        FROM dbo.users u
        LEFT JOIN dbo.plant_members pm ON pm.uid = u.uid AND pm.is_active = 1
        LEFT JOIN dbo.plants p ON p.plant_id = pm.plant_id
        WHERE u.uid = @uid
        ORDER BY p.name
      `);
    return json({
      auth: user,
      ...serializeUserContextRows(result.recordset)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function getPlantBootstrap(request) {
  try {
    const user = await authenticateRequest(request);
    const plantId = request.params.plantId;
    const member = await requirePlantPermission(plantId, user, 'canViewPlant');
    const pool = await getPool();
    const [plant, statuses, presses, game] = await Promise.all([
      pool.request()
        .input('plantId', sql.NVarChar(80), plantId)
        .query('SELECT * FROM dbo.plants WHERE plant_id = @plantId'),
      pool.request()
        .input('plantId', sql.NVarChar(80), plantId)
        .query('SELECT * FROM dbo.plant_status_config WHERE plant_id = @plantId'),
      pool.request()
        .input('plantId', sql.NVarChar(80), plantId)
        .query('SELECT * FROM dbo.plant_press_config WHERE plant_id = @plantId'),
      pool.request()
        .input('plantId', sql.NVarChar(80), plantId)
        .query('SELECT * FROM dbo.gamification_config WHERE plant_id = @plantId')
    ]);
    return json({
      plant: serializePlant(plant.recordset[0]),
      member: serializePlantMember(member),
      statusConfig: serializeStatusConfig(statuses.recordset[0]),
      pressConfig: serializePressConfig(presses.recordset[0]),
      gamificationConfig: serializeGamificationConfig(game.recordset[0])
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function listIssues(request) {
  try {
    const user = await authenticateRequest(request);
    const plantId = request.params.plantId;
    await requirePlantPermission(plantId, user, 'canViewPlant');
    const limit = Math.max(1, Math.min(500, Number(request.query.get('limit')) || 250));
    const pool = await getPool();
    const result = await pool.request()
      .input('plantId', sql.NVarChar(80), plantId)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT TOP (@limit) *
        FROM dbo.issues
        WHERE plant_id = @plantId
        ORDER BY created_at DESC
      `);
    return json({ issues: result.recordset.map(serializeIssue) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function getIssue(request) {
  try {
    const user = await authenticateRequest(request);
    const plantId = request.params.plantId;
    const issueId = request.params.issueId;
    await requirePlantPermission(plantId, user, 'canViewPlant');
    const pool = await getPool();
    const result = await pool.request()
      .input('plantId', sql.NVarChar(80), plantId)
      .input('issueId', sql.NVarChar(128), issueId)
      .query(`
        SELECT TOP (1) *
        FROM dbo.issues
        WHERE plant_id = @plantId AND issue_id = @issueId
      `);
    const issue = serializeIssue(result.recordset[0]);
    if (!issue) {
      return json({ error: 'Issue not found' }, { status: 404 });
    }
    return json({ issue });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function listIssueEvents(request) {
  try {
    const user = await authenticateRequest(request);
    const plantId = request.params.plantId;
    const issueId = request.params.issueId;
    await requirePlantPermission(plantId, user, 'canViewPlant');
    const pool = await getPool();
    const result = await pool.request()
      .input('plantId', sql.NVarChar(80), plantId)
      .input('issueId', sql.NVarChar(128), issueId)
      .query(`
        SELECT *
        FROM dbo.issue_events
        WHERE plant_id = @plantId AND issue_id = @issueId
        ORDER BY event_at ASC, created_at ASC
      `);
    return json({ events: result.recordset.map(serializeIssueEvent) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function listIssueAttachments(request) {
  try {
    const user = await authenticateRequest(request);
    const plantId = request.params.plantId;
    const issueId = request.params.issueId;
    await requirePlantPermission(plantId, user, 'canViewPlant');
    const pool = await getPool();
    const result = await pool.request()
      .input('plantId', sql.NVarChar(80), plantId)
      .input('issueId', sql.NVarChar(128), issueId)
      .query(`
        SELECT *
        FROM dbo.issue_attachments
        WHERE plant_id = @plantId AND issue_id = @issueId
        ORDER BY uploaded_at DESC
      `);
    return json({ attachments: result.recordset.map(serializeIssueAttachment) });
  } catch (error) {
    return errorResponse(error);
  }
}
