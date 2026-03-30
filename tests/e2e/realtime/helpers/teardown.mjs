export async function teardown(fns = [], logger = console) {
  for (const fn of fns) {
    if (typeof fn !== 'function') {
      continue;
    }

    try {
      await fn();
    } catch (error) {
      logger?.warn?.('teardown step failed', {
        message: error?.message,
        stack: error?.stack
      });
    }
  }
}

export default teardown;
