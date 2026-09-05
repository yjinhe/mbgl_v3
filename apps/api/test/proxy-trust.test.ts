import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { proxyTrust } from '../src/services/proxy-trust.js';

describe('bounded internal proxy trust', () => {
  test('zero hops disables forwarding trust', () => {
    expect(proxyTrust(0)).toBe(false);
  });

  test('accepts the internal deployment peers, including IPv4-mapped IPv6', () => {
    const trust = proxyTrust(1);
    if (!trust) throw new Error('missing proxy policy');
    for (const address of ['127.0.0.1', '::1', '172.18.0.1', '10.0.0.2', '192.168.1.2', '::ffff:172.18.0.1', 'fd00::2']) {
      expect(trust(address, 0), address).toBe(true);
    }
  });

  test('does not trust public peers, invalid addresses or extra hops', () => {
    const trust = proxyTrust(1);
    if (!trust) throw new Error('missing proxy policy');
    for (const address of ['203.0.113.10', '2001:db8::1', 'not-an-ip']) expect(trust(address, 0)).toBe(false);
    expect(trust('172.18.0.1', 1)).toBe(false);
  });

  test('ignores forwarded headers supplied by a direct public peer', async () => {
    const app = Fastify({ trustProxy: proxyTrust(1) });
    app.get('/peer', (request) => ({ ip: request.ip, protocol: request.protocol }));
    try {
      const response = await app.inject({ url: '/peer', remoteAddress: '203.0.113.10', headers: {
        'x-forwarded-for': '198.51.100.2', 'x-forwarded-proto': 'https'
      } });
      expect(response.json()).toEqual({ ip: '203.0.113.10', protocol: 'http' });
    } finally { await app.close(); }
  });

  test('uses only the configured hop behind the internal reverse proxy', async () => {
    const app = Fastify({ trustProxy: proxyTrust(1) });
    app.get('/peer', (request) => ({ ip: request.ip, protocol: request.protocol }));
    try {
      const response = await app.inject({ url: '/peer', remoteAddress: '172.18.0.1', headers: {
        'x-forwarded-for': '198.51.100.2, 203.0.113.10', 'x-forwarded-proto': 'https'
      } });
      expect(response.json()).toEqual({ ip: '203.0.113.10', protocol: 'https' });
    } finally { await app.close(); }
  });
});
