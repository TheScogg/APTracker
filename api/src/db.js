import sql from 'mssql';

let poolPromise;

export function getPool() {
  if (!poolPromise) {
    const connectionString = process.env.SQL_CONNECTION_STRING;
    if (!connectionString) {
      throw Object.assign(new Error('SQL_CONNECTION_STRING is not configured'), { status: 500 });
    }
    poolPromise = sql.connect(connectionString);
  }
  return poolPromise;
}

export { sql };
