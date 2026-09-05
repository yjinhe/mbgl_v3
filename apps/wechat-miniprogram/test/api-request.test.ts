import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const root = path.resolve(__dirname, '..');

function loadApi() {
  const source = fs.readFileSync(path.join(root, 'utils/api.js'), 'utf8');
  const cjsModule: { exports: Record<string, any> } = { exports: {} };
  const execute = new Function('require', 'module', 'exports', source);
  execute(() => ({}), cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

function installWxRequest(statusCode = 204, responseData: unknown = null) {
  const request = vi.fn((options: Record<string, any>) => {
    options.success({ statusCode, data: responseData });
  });
  (globalThis as any).wx = {
    getStorageSync: vi.fn(() => ''),
    request
  };
  return request;
}

describe('wechat api request payloads', () => {
  afterEach(() => {
    delete (globalThis as any).wx;
  });

  test('sends an explicit JSON object for a bodyless DELETE request', async () => {
    const wxRequest = installWxRequest();
    const api = loadApi();

    await api.request('/api/app/records/glucose/record-id', { method: 'DELETE' });

    expect(wxRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'DELETE',
      data: {},
      header: expect.objectContaining({ 'content-type': 'application/json' })
    }));
  });

  test('also protects bodyless POST actions such as restoring a record', async () => {
    const wxRequest = installWxRequest(200, { record: { id: 'record-id' } });
    const api = loadApi();

    await api.request('/api/app/records/glucose/record-id/restore', { method: 'POST' });

    expect(wxRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      data: {}
    }));
  });

  test('keeps GET requests bodyless and preserves supplied mutation data', async () => {
    const wxRequest = installWxRequest(200, {});
    const api = loadApi();

    await api.request('/api/app/overview');
    await api.request('/api/app/records/glucose', {
      method: 'POST',
      data: { value: 6.8 }
    });

    expect(wxRequest.mock.calls[0][0]).toMatchObject({ method: 'GET', data: undefined });
    expect(wxRequest.mock.calls[1][0]).toMatchObject({
      method: 'POST',
      data: { value: 6.8 }
    });
  });
});
