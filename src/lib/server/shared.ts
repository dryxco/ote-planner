// One copy of a piece of server state for the whole process.
//
// Next builds the background jobs (instrumentation) and the API routes as separate bundles, each
// with its own copy of every module — so a module-level cache or lock existed twice. On 10/10 the
// jobs' copy of the sync data never saw what devices saved: its task sync took to-dos made since
// as "no longer in Ote", archived them on the board, and the routes' copy then deleted them here.
// State that must be single (caches of files, write queues, run locks) goes through this.
export function shared<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as { __syncShared?: Record<string, unknown> };
  const all = (g.__syncShared ??= {});
  if (!(key in all)) all[key] = init();
  return all[key] as T;
}
