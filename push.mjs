// Web push for the installed app (admin notifications). VAPID keys are generated once and kept sealed in the database.
import webpush from 'web-push';

export function pushService({ repo, box, subject }) {
  let keys = null;
  async function vapid() {
    if (keys) return keys;
    const stored = await repo.getSecret('vapid');
    let found = stored ? box.open(stored) : null;
    if (!found) {
      await repo.putSecret('vapid', box.seal(webpush.generateVAPIDKeys()));
      // Another instance may have created it first: always use what is stored.
      found = box.open(await repo.getSecret('vapid'));
    }
    if (!found?.publicKey || !found?.privateKey) throw new Error('Chaves de notificação indisponíveis.');
    keys = found;
    return keys;
  }
  return {
    async publicKey() { return (await vapid()).publicKey; },
    // Sends to every active admin device of the tenant. Never throws: an order must not fail because of a notification.
    async notifyAdmins(tenantId, message) {
      try {
        const subs = await repo.listAdminPushSubscriptions(tenantId);
        if (!subs.length) return 0;
        const { publicKey, privateKey } = await vapid();
        const payload = JSON.stringify(message);
        let sent = 0;
        const deliveries = subs.map(async s => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { vapidDetails: { subject, publicKey, privateKey }, TTL: 86400, urgency: 'high', timeout: 5000 });
            sent++;
          } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) await repo.deletePushSubscription(s.endpoint).catch(() => {});
            else console.warn('[push] envio', error.statusCode || '', String(error.body || error.message).slice(0, 200));
          }
        });
        await Promise.race([Promise.allSettled(deliveries), new Promise(done => setTimeout(done, 6000))]);
        return sent;
      } catch (error) { console.warn('[push] falha', error.message); return 0; }
    }
  };
}
