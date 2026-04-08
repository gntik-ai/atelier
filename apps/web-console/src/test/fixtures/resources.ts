export const FIXTURE_PG_DB = {
  resourceId: 'db_pg1',
  name: 'orders',
  host: 'db.example.test',
  port: 5432,
  engine: 'postgresql',
  schema: 'public',
  resourceState: 'active'
} as const

export const FIXTURE_MONGO_COLL = {
  resourceId: 'mongo_coll1',
  name: 'events',
  host: 'mongo.example.test',
  port: 27017,
  engine: 'mongodb',
  database: 'app',
  resourceState: 'active'
} as const

export const FIXTURE_STORAGE_BUCKET = {
  resourceId: 'bucket_1',
  name: 'assets',
  host: 'https://s3.example.test',
  port: 443,
  region: 'eu-west-1',
  presignedUrl: 'https://s3.example.test/assets/presigned',
  resourceState: 'active'
} as const

export const FIXTURE_FUNCTION = {
  resourceId: 'fn_1',
  name: 'hello',
  host: 'functions.example.test',
  port: 443,
  runtime: 'nodejs:20',
  endpointUrl: 'https://functions.example.test/hello',
  resourceState: 'active'
} as const

export const FIXTURE_IAM_CLIENT = {
  resourceId: 'iam_1',
  name: 'falcone-console',
  host: 'sso.example.test',
  port: 443,
  clientType: 'confidential',
  tokenEndpoint: 'https://sso.example.test/token',
  resourceState: 'active'
} as const

export const FIXTURE_PG_DB_PROVISIONING = {
  ...FIXTURE_PG_DB,
  resourceState: 'provisioning'
} as const

export const FIXTURE_PG_DB_NO_ENDPOINT = {
  ...FIXTURE_PG_DB,
  host: null,
  port: null
} as const
