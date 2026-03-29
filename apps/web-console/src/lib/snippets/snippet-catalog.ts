import type { ResourceType } from './snippet-types'

export interface SnippetTemplate {
  id: string
  label: string
  codeTemplate: string
  fallbackNotes?: string[]
  secretTokens?: string[]
  secretPlaceholderRef: string | null
}

const POSTGRES_SECRET_REF = 'Usa la credencial del usuario de base de datos mostrada en la consola del workspace.'
const MONGO_SECRET_REF = 'Usa la contraseña o API key del usuario Mongo provisionado para este workspace.'
const STORAGE_SECRET_REF = 'Sustituye los placeholders por tus access keys del workspace o credenciales temporales.'
const FUNCTION_SECRET_REF = 'Añade tu token/API key real según la política HTTP expuesta por la función.'
const IAM_SECRET_REF = 'Sustituye <CLIENT_SECRET> por el secreto confidencial generado para este cliente IAM.'

export const SNIPPET_CATALOG: Record<ResourceType, SnippetTemplate[]> = {
  'postgres-database': [
    {
      id: 'postgres-uri',
      label: 'URI PostgreSQL',
      codeTemplate: 'postgresql://<PG_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_NAME}?sslmode=require',
      fallbackNotes: ['Si el endpoint aún no aparece en la consola, usa el placeholder y actualízalo cuando el host quede disponible.'],
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: POSTGRES_SECRET_REF
    },
    {
      id: 'postgres-node-pg',
      label: 'Node.js — pg',
      codeTemplate: `import { Client } from 'pg'\n\nconst client = new Client({\n  host: '{HOST}',\n  port: {PORT},\n  database: '{RESOURCE_NAME}',\n  user: '<PG_USER>',\n  password: '{PASSWORD}',\n  ssl: true\n})\n\nawait client.connect()\nconst result = await client.query('select now()')\nconsole.log(result.rows[0])\nawait client.end()`,
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: POSTGRES_SECRET_REF
    },
    {
      id: 'postgres-python-psycopg2',
      label: 'Python — psycopg2',
      codeTemplate: `import psycopg2\n\nconn = psycopg2.connect(\n    host='{HOST}',\n    port={PORT},\n    dbname='{RESOURCE_NAME}',\n    user='<PG_USER>',\n    password='{PASSWORD}',\n    sslmode='require'\n)\n\nwith conn.cursor() as cur:\n    cur.execute('select current_schema()')\n    print(cur.fetchone())\n\nconn.close()`,
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: POSTGRES_SECRET_REF
    }
  ],
  'mongo-collection': [
    {
      id: 'mongo-uri',
      label: 'MongoDB URI',
      codeTemplate: 'mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_EXTRA_A}?authSource=admin&retryWrites=true&w=majority',
      fallbackNotes: ['La colección usa como base la base de datos seleccionada; revisa el placeholder del host si aún no hay endpoint público.'],
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: MONGO_SECRET_REF
    },
    {
      id: 'mongo-node-mongoose',
      label: 'Node.js — mongoose',
      codeTemplate: `import mongoose from 'mongoose'\n\nawait mongoose.connect('mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_EXTRA_A}?authSource=admin')\n\nconst collection = mongoose.connection.collection('{RESOURCE_NAME}')\nconst count = await collection.countDocuments()\nconsole.log({ count })\n\nawait mongoose.disconnect()`,
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: MONGO_SECRET_REF
    },
    {
      id: 'mongo-python-pymongo',
      label: 'Python — pymongo',
      codeTemplate: `from pymongo import MongoClient\n\nclient = MongoClient('mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_EXTRA_A}?authSource=admin')\ncollection = client['{RESOURCE_EXTRA_A}']['{RESOURCE_NAME}']\nprint(collection.estimated_document_count())\nclient.close()`,
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: MONGO_SECRET_REF
    }
  ],
  'storage-bucket': [
    {
      id: 'storage-aws-cli',
      label: 'AWS CLI — s3',
      codeTemplate: 'aws --endpoint-url {HOST} s3 ls s3://{RESOURCE_NAME} --region {RESOURCE_EXTRA_A}',
      fallbackNotes: ['El endpoint puede seguir siendo interno; si no está publicado, usa el placeholder y la documentación del workspace.'],
      secretTokens: ['<AWS_ACCESS_KEY_ID>', '<AWS_SECRET_ACCESS_KEY>'],
      secretPlaceholderRef: STORAGE_SECRET_REF
    },
    {
      id: 'storage-node-sdk',
      label: 'Node.js — @aws-sdk/client-s3',
      codeTemplate: `import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'\n\nconst client = new S3Client({\n  endpoint: '{HOST}',\n  region: '{RESOURCE_EXTRA_A}',\n  credentials: {\n    accessKeyId: '<AWS_ACCESS_KEY_ID>',\n    secretAccessKey: '<AWS_SECRET_ACCESS_KEY>'\n  },\n  forcePathStyle: true\n})\n\nconst result = await client.send(new ListObjectsV2Command({ Bucket: '{RESOURCE_NAME}' }))\nconsole.log(result.Contents ?? [])`,
      secretTokens: ['<AWS_ACCESS_KEY_ID>', '<AWS_SECRET_ACCESS_KEY>'],
      secretPlaceholderRef: STORAGE_SECRET_REF
    },
    {
      id: 'storage-python-boto3',
      label: 'Python — boto3',
      codeTemplate: `import boto3\n\ns3 = boto3.client(\n    's3',\n    endpoint_url='{HOST}',\n    region_name='{RESOURCE_EXTRA_A}',\n    aws_access_key_id='<AWS_ACCESS_KEY_ID>',\n    aws_secret_access_key='<AWS_SECRET_ACCESS_KEY>'\n)\n\nresponse = s3.list_objects_v2(Bucket='{RESOURCE_NAME}')\nprint(response.get('Contents', []))`,
      secretTokens: ['<AWS_ACCESS_KEY_ID>', '<AWS_SECRET_ACCESS_KEY>'],
      secretPlaceholderRef: STORAGE_SECRET_REF
    },
    {
      id: 'storage-curl-presigned',
      label: 'cURL — presigned URL',
      codeTemplate: 'curl -X GET "{RESOURCE_EXTRA_B}"',
      fallbackNotes: ['Sustituye la URL firmada cuando la generes desde la superficie presigned del bucket.'],
      secretTokens: [],
      secretPlaceholderRef: STORAGE_SECRET_REF
    }
  ],
  'serverless-function': [
    {
      id: 'function-curl',
      label: 'cURL',
      codeTemplate: 'curl -X POST "{RESOURCE_EXTRA_B}" -H "Content-Type: application/json" -H "Authorization: Bearer <API_TOKEN>" -d \'{"ping":true}\'' ,
      fallbackNotes: ['Si la exposición HTTP está deshabilitada, la URL se mantiene como placeholder hasta activar el endpoint.'],
      secretTokens: ['<API_TOKEN>'],
      secretPlaceholderRef: FUNCTION_SECRET_REF
    },
    {
      id: 'function-node-fetch',
      label: 'Node.js — fetch',
      codeTemplate: `const response = await fetch('{RESOURCE_EXTRA_B}', {\n  method: 'POST',\n  headers: {\n    'content-type': 'application/json',\n    authorization: 'Bearer <API_TOKEN>'\n  },\n  body: JSON.stringify({ ping: true })\n})\n\nconsole.log(await response.json())`,
      secretTokens: ['<API_TOKEN>'],
      secretPlaceholderRef: FUNCTION_SECRET_REF
    },
    {
      id: 'function-python-requests',
      label: 'Python — requests',
      codeTemplate: `import requests\n\nresponse = requests.post(\n    '{RESOURCE_EXTRA_B}',\n    headers={\n        'content-type': 'application/json',\n        'authorization': 'Bearer <API_TOKEN>'\n    },\n    json={'ping': True}\n)\n\nprint(response.json())`,
      secretTokens: ['<API_TOKEN>'],
      secretPlaceholderRef: FUNCTION_SECRET_REF
    }
  ],
  'iam-client': [
    {
      id: 'iam-client-credentials-curl',
      label: 'cURL — client_credentials',
      codeTemplate: `curl -X POST '{RESOURCE_EXTRA_B}' \\\n  -H 'content-type: application/x-www-form-urlencoded' \\\n  --data-urlencode 'grant_type=client_credentials' \\\n  --data-urlencode 'client_id={RESOURCE_NAME}' \\\n  --data-urlencode 'client_secret=<CLIENT_SECRET>'`,
      fallbackNotes: ['El token endpoint depende del realm activo; si no está resuelto en la consola, se muestra como placeholder descriptivo.'],
      secretTokens: ['<CLIENT_SECRET>'],
      secretPlaceholderRef: IAM_SECRET_REF
    }
  ]
}
