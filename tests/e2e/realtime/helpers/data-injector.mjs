import pg from 'pg';
import { MongoClient } from 'mongodb';

const { Pool } = pg;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const WS_PG_CONN_STR = requireEnv('WS_PG_CONN_STR');
const WS_MONGO_CONN_STR = requireEnv('WS_MONGO_CONN_STR');

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildWhereClause(where, startIndex = 1) {
  const entries = Object.entries(where);
  const clauses = entries.map(([key], index) => `${quoteIdentifier(key)} = $${startIndex + index}`);
  const values = entries.map(([, value]) => value);
  return {
    sql: clauses.join(' AND '),
    values
  };
}

export function createDataInjector() {
  let pool;
  let mongoClient;

  function getPool() {
    pool ??= new Pool({ connectionString: WS_PG_CONN_STR });
    return pool;
  }

  async function getMongoClient() {
    mongoClient ??= new MongoClient(WS_MONGO_CONN_STR);
    if (!mongoClient.topology?.isConnected?.()) {
      await mongoClient.connect();
    }
    return mongoClient;
  }

  return {
    async pgInsert({ schema = 'public', table, row }) {
      const keys = Object.keys(row);
      const values = Object.values(row);
      const columns = keys.map(quoteIdentifier).join(', ');
      const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
      const sql = `INSERT INTO ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (${columns}) VALUES (${placeholders}) RETURNING id`;
      const result = await getPool().query(sql, values);
      return { rowId: result.rows[0]?.id ?? row.id };
    },
    async pgUpdate({ schema = 'public', table, where, set }) {
      const setEntries = Object.entries(set);
      const setSql = setEntries.map(([key], index) => `${quoteIdentifier(key)} = $${index + 1}`).join(', ');
      const whereClause = buildWhereClause(where, setEntries.length + 1);
      const sql = `UPDATE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} SET ${setSql} WHERE ${whereClause.sql}`;
      await getPool().query(sql, [...setEntries.map(([, value]) => value), ...whereClause.values]);
    },
    async pgDelete({ schema = 'public', table, where }) {
      const whereClause = buildWhereClause(where);
      const sql = `DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} WHERE ${whereClause.sql}`;
      await getPool().query(sql, whereClause.values);
    },
    async mongoInsert({ db, collection, doc }) {
      const client = await getMongoClient();
      const result = await client.db(db).collection(collection).insertOne(doc);
      return { docId: result.insertedId };
    },
    async mongoUpdate({ db, collection, filter, update }) {
      const client = await getMongoClient();
      await client.db(db).collection(collection).updateMany(filter, update);
    },
    async mongoDelete({ db, collection, filter }) {
      const client = await getMongoClient();
      await client.db(db).collection(collection).deleteMany(filter);
    },
    async close() {
      await Promise.allSettled([
        pool?.end?.(),
        mongoClient?.close?.()
      ]);
    }
  };
}

export default createDataInjector;
