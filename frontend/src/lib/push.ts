import { api } from "./api";

export type PushState = "unsupported" | "needs-install" | "denied" | "on" | "off";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // Push is an enhancement; the app works without it.
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

export async function getPushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("PushManager" in window) || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function enablePush(vapidPublicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = (await registration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(vapidPublicKey),
    }));
  await api.post("/api/push/subscribe", subscription.toJSON());
  return "on";
}

/**
 * Re-register this device's existing subscription for whoever is signed in now,
 * so alerts follow the person using the phone (and the server's copy stays fresh).
 */
export async function syncPushSubscription(): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) await api.post("/api/push/subscribe", subscription.toJSON());
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await api.post("/api/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe();
}

export async function sendTestPush(): Promise<number> {
  return (await api.post<{ delivered: number }>("/api/push/test")).delivered;
}
