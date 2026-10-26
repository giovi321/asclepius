import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

export interface FakeCall {
  method: string;
  url: string;
  status: number;
}

/** Handler result: a status plus optional JSON body and headers. */
export type FakeReply = {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
};

/** The reply the share backend gives for a dead session. */
export const SESSION_ENDED_REPLY: FakeReply = {
  status: 410,
  data: { detail: "Share session expired" },
  headers: { "x-share-session": "ended" },
};

/**
 * Axios adapter for tests: every request that reaches it is recorded
 * (requests rejected by an interceptor never get here, which is how the
 * tests prove "nothing hit the network"), and answered by ``handler``.
 * Statuses >= 400 reject with an AxiosError carrying the response, like
 * the real http adapter.
 */
export function fakeAdapter(
  handler: (method: string, url: string) => FakeReply,
): { adapter: AxiosAdapter; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const method = (config.method || "get").toLowerCase();
    const url = config.url || "";
    const { status, data, headers } = handler(method, url);
    calls.push({ method, url, status });
    const response: AxiosResponse = {
      status,
      statusText: "",
      data: data ?? {},
      headers: { "content-type": "application/json", ...headers },
      config,
    };
    if (status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST",
        config,
        null,
        response,
      );
    }
    return response;
  };
  return { adapter, calls };
}

/** Number of recorded responses the proxy's fail2ban jail would count. */
export function banCounted(calls: FakeCall[]): number {
  return calls.filter((c) => [401, 403, 404].includes(c.status)).length;
}
