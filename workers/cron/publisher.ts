/**
 * The workerd-safe raw publisher now lives in src/lib/rawPublish.ts, so the
 * Pages app (Go live report alerts) and this worker share one copy.
 */
export * from '../../src/lib/rawPublish';
