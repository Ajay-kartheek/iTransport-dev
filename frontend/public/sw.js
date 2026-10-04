/* iTransport service worker: shows bus alerts sent by the server (Web Push). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "iTransport";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      vibrate: [80, 40, 80],
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

function keyBytes(base64url) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function postJson(path, body) {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Push services occasionally rotate a subscription; re-subscribe so alerts keep arriving.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      let key = old && old.options ? old.options.applicationServerKey : null;
      if (!key) {
        const config = await fetch("/api/config", { credentials: "same-origin" })
          .then((r) => r.json())
          .catch(() => null);
        if (!config || !config.vapidPublicKey) return;
        key = keyBytes(config.vapidPublicKey);
      }
      const fresh =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      await postJson("/api/push/subscribe", fresh.toJSON()).catch(() => undefined);
      if (old) await postJson("/api/push/unsubscribe", { endpoint: old.endpoint }).catch(() => undefined);
    })(),
  );
});
