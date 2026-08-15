import { validateProviderKey } from '@/ai/provider/validateKey';

function fetchReturning(status: number, body: unknown = {}) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('validateProviderKey', () => {
  it('reports ok on a 200', async () => {
    await expect(
      validateProviderKey('anthropic', 'sk-ant-x', fetchReturning(200) as never)
    ).resolves.toStrictEqual({ ok: true });
  });

  // The reason a wrong key is worth distinguishing from an outage: one is the
  // user's mistake and actionable, the other is not. #168 warns either way but
  // the copy differs.
  it('reports unauthorized on a 401, not a generic failure', async () => {
    await expect(
      validateProviderKey('openai', 'sk-bad', fetchReturning(401) as never)
    ).resolves.toStrictEqual({ ok: false, reason: 'unauthorized', status: 401 });
  });

  // 403 is the other half of "the key is the problem": both providers use it
  // for a key that authenticates but is not permitted (no credit, wrong org,
  // blocked region). Reporting that as `http` would tell the user the network
  // failed when the actionable truth is their key.
  it('reports unauthorized on a 403 too, not just a 401', async () => {
    await expect(
      validateProviderKey('anthropic', 'sk-ant-x', fetchReturning(403) as never)
    ).resolves.toStrictEqual({ ok: false, reason: 'unauthorized', status: 403 });
  });

  it('reports http with the status for other failures', async () => {
    await expect(
      validateProviderKey('openai', 'sk-x', fetchReturning(500) as never)
    ).resolves.toStrictEqual({ ok: false, reason: 'http', status: 500 });
  });

  it('reports unreachable when the request throws', async () => {
    const boom = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(validateProviderKey('anthropic', 'sk-ant-x', boom as never)).resolves.toStrictEqual(
      { ok: false, reason: 'unreachable' }
    );
  });

  // Per-provider auth headers differ, and sending the wrong one would make a
  // GOOD key look unauthorized — the worst failure for this feature, because
  // the user would conclude their key is bad.
  it('sends the Anthropic auth header shape', async () => {
    const f = fetchReturning(200);
    await validateProviderKey('anthropic', 'sk-ant-CANARY', f as never);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain('api.anthropic.com');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-CANARY');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBeTruthy();
  });

  it('sends the OpenAI auth header shape', async () => {
    const f = fetchReturning(200);
    await validateProviderKey('openai', 'sk-CANARY', f as never);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain('api.openai.com');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-CANARY');
  });

  // Trimming matters: apiKeyPatch trims on the way into storage, and validating
  // an untrimmed value would 401 a key that will actually work once saved.
  it('trims the key before sending it', async () => {
    const f = fetchReturning(200);
    await validateProviderKey('openai', '  sk-PADDED\n', f as never);
    const [, init] = f.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-PADDED');
  });

  it('treats a blank key as unauthorized without calling the network', async () => {
    const f = fetchReturning(200);
    await expect(validateProviderKey('openai', '   ', f as never)).resolves.toStrictEqual({
      ok: false,
      reason: 'unauthorized',
    });
    expect(f).not.toHaveBeenCalled();
  });
});
