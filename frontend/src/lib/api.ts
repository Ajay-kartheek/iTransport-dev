export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Listener = (error: ApiError) => void;
const authListeners = new Set<Listener>();

/** Notified when the server says the session is gone or a password change is required. */
export function onAuthProblem(listener: Listener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

// Server clock offset, so countdowns stay right even if the phone's clock is off.
let clockOffset = 0;
export function serverNow(): number {
  return Date.now() + clockOffset;
}
/** How far the server's clock is ahead of this device's (ms). */
export function clockOffsetMs(): number {
  return clockOffset;
}
export function syncClock(serverMs: number | undefined): void {
  if (typeof serverMs === "number") clockOffset = serverMs - Date.now();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "You're offline. Check your connection and try again.");
  }

  let data: unknown = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    const problem = new ApiError(
      response.status,
      error?.code ?? "error",
      error?.message ?? "Something went wrong. Please try again.",
    );
    if (response.status === 401 || problem.code === "password_change_required") {
      authListeners.forEach((listener) => listener(problem));
    }
    throw problem;
  }
  const now = (data as { now?: number } | null)?.now;
  if (typeof now === "number") syncClock(now);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
