// Runs before every API test file (vitest setupFiles), i.e. before src/env.ts is imported.
// env.ts no longer provides fail-open defaults, so the test suite supplies its own secrets here.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-only-secret';
process.env.WECHAT_MOCK ??= 'true';
// Measurement reminder templates (spec §7). Ids are test-only; field keys use the documented defaults.
process.env.WECHAT_TEMPLATE_GLUCOSE_REMINDER ??= 'test-glucose-reminder-template';
process.env.WECHAT_TEMPLATE_GLUCOSE_FIELDS ??= 'time1,thing2,thing3';
process.env.WECHAT_TEMPLATE_BP_REMINDER ??= 'test-bp-reminder-template';
process.env.WECHAT_TEMPLATE_BP_FIELDS ??= 'time1,thing2';
// Medication reminder template (docs/WECHAT-MEDICATION-SPEC.md §7).
process.env.WECHAT_TEMPLATE_MEDICATION_REMINDER ??= 'test-medication-reminder-template';
process.env.WECHAT_TEMPLATE_MEDICATION_FIELDS ??= 'time1,thing2,thing3';
process.env.WECHAT_MINIPROGRAM_STATE ??= 'trial';

export {};
