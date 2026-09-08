import { defineConfig } from 'vitest/config';

// The mini program runs on devices in China (UTC+8) and its tests assert on local
// dates/times. Pin the zone so the suite behaves the same on CI (UTC) as on a
// developer machine in Asia/Shanghai.
process.env.TZ = 'Asia/Shanghai';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: { TZ: 'Asia/Shanghai' }
  }
});
