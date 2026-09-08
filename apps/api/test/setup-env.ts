// Runs before every API test file (vitest setupFiles), i.e. before src/env.ts is imported.
// env.ts no longer provides fail-open defaults, so the test suite supplies its own secrets here.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-only-secret';
process.env.WECHAT_MOCK ??= 'true';

export {};
