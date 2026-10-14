import mysql from 'mysql2/promise';

export function createPool(databaseConfig) {
  return mysql.createPool({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.name,
    waitForConnections: true,
    connectionLimit: databaseConfig.connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: true,
    multipleStatements: false,
  });
}

export async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Keep the original operation error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function checkDatabase(pool) {
  await pool.query('SELECT 1 AS ready');
  return true;
}
