/**
 * A stand-in for Cloudflare Stream's live-input API at global fetch, for
 * the Go live sweep and admin tests. It keeps a set of inputs and lets a
 * test script each input's reported status and make calls fail.
 */
import { vi } from 'vitest';

export const STUB_ACCOUNT = '2d2f9386809ef6f9cda581aa16dff31c';

export interface StubInput {
  uid: string;
  name: string;
  /** ISO time, or null to omit `created` from the listing. */
  created: string | null;
  /** Cloudflare's status word, or null for "never reported a status". */
  state: string | null;
  lastSeen: string | null;
}

export function createStreamStub() {
  const stub = {
    inputs: new Map<string, StubInput>(),
    calls: [] as string[],
    deleteStatus: 200,
    statusHttp: 200,
    statusThrows: false,
    listHttp: 200,
    add(partial: Partial<StubInput> & { uid: string }): StubInput {
      const input: StubInput = {
        name: '',
        created: new Date(Date.now() - 3600_000).toISOString(),
        state: 'connected',
        lastSeen: new Date().toISOString(),
        ...partial
      };
      stub.inputs.set(input.uid, input);
      return input;
    },
    deletes(): string[] {
      return stub.calls.filter((c) => c.startsWith('delete:')).map((c) => c.slice(7));
    },
    install() {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (target: string | URL | Request, init: RequestInit = {}) => {
          const url = String(target);
          const method = init.method ?? 'GET';
          const base = `https://api.cloudflare.com/client/v4/accounts/${STUB_ACCOUNT}/stream/live_inputs`;
          if (!url.startsWith(base)) throw new Error(`unexpected fetch ${method} ${url}`);
          const uid = url.slice(base.length).replace(/^\//, '');
          if (method === 'GET' && uid === '') {
            stub.calls.push('list');
            if (stub.listHttp !== 200) return new Response('{}', { status: stub.listHttp });
            return new Response(
              JSON.stringify({
                success: true,
                result: [...stub.inputs.values()].map((i) => ({
                  uid: i.uid,
                  meta: { name: i.name },
                  ...(i.created ? { created: i.created } : {})
                }))
              }),
              { status: 200 }
            );
          }
          if (method === 'GET') {
            stub.calls.push(`status:${uid}`);
            if (stub.statusThrows) throw new DOMException('timed out', 'TimeoutError');
            if (stub.statusHttp !== 200) return new Response('{}', { status: stub.statusHttp });
            const input = stub.inputs.get(uid);
            if (!input) return new Response('{"success":false}', { status: 404 });
            return new Response(
              JSON.stringify({
                success: true,
                result: {
                  uid,
                  status: input.state
                    ? {
                        current: {
                          ingestProtocol: 'webrtc',
                          state: input.state,
                          statusLastSeen: input.lastSeen
                        },
                        history: []
                      }
                    : null
                }
              }),
              { status: 200 }
            );
          }
          if (method === 'DELETE') {
            stub.calls.push(`delete:${uid}`);
            if (stub.deleteStatus !== 200) return new Response('{}', { status: stub.deleteStatus });
            return new Response('{}', { status: stub.inputs.delete(uid) ? 200 : 404 });
          }
          throw new Error(`unexpected fetch ${method} ${url}`);
        })
      );
    }
  };
  return stub;
}

/** A fake of the GATED_CONTENT KV namespace. */
export function createKvFake() {
  const data = new Map<string, string>();
  return {
    data,
    failReads: false,
    failWrites: false,
    async get(key: string) {
      if (this.failReads) throw new Error('KV read failed');
      return data.get(key) ?? null;
    },
    async put(key: string, value: string) {
      if (this.failWrites) throw new Error('KV write failed');
      data.set(key, value);
    },
    async delete(key: string) {
      if (this.failWrites) throw new Error('KV write failed');
      data.delete(key);
    }
  };
}
