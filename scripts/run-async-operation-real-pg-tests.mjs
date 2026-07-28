import { spawn } from 'node:child_process';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    'C-11 real PostgreSQL tests require TEST_DATABASE_URL or DATABASE_URL; refusing to skip.'
  );
  process.exitCode = 1;
} else {
  try {
    await import('pg');
  } catch (error) {
    console.error(`C-11 real PostgreSQL tests require the pg package: ${error.message}`);
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    process.exitCode = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ['--test', 'tests/integration/async-operation-query-integration.test.mjs'],
        {
          env: {
            ...process.env,
            TEST_DATABASE_URL: connectionString
          },
          stdio: 'inherit'
        }
      );

      child.on('error', (error) => {
        console.error(`Unable to start the C-11 real PostgreSQL tests: ${error.message}`);
        resolve(1);
      });

      child.on('exit', (code, signal) => {
        if (signal) {
          console.error(`C-11 real PostgreSQL tests terminated by ${signal}.`);
          resolve(1);
          return;
        }
        resolve(code ?? 1);
      });
    }
    );
  }
}
