import { getPool, sql } from './db.js';

export async function requirePlantPermission(plantId, user, permissionName) {
  const pool = await getPool();
  const result = await pool.request()
    .input('plantId', sql.NVarChar(80), plantId)
    .input('uid', sql.NVarChar(128), user.uid)
    .query(`
      SELECT role, is_active, permissions_json
      FROM dbo.plant_members
      WHERE plant_id = @plantId AND uid = @uid
    `);
  const member = result.recordset[0];
  if (!member || !member.is_active) {
    throw Object.assign(new Error('Plant access denied'), { status: 403 });
  }
  if (permissionName) {
    const permissions = JSON.parse(member.permissions_json || '{}');
    if (permissions[permissionName] !== true) {
      throw Object.assign(new Error('Permission denied'), { status: 403 });
    }
  }
  return member;
}
