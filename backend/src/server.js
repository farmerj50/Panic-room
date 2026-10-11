const app = require("./app");
const { purgeExpiredConsentEvents } = require("./services/smsConsentService");
const { sweepStaleReservations } = require("./services/smsDispatchService");
const { purgeExpiredLinks } = require("./services/liveViewService");
const { checkStorageDurability } = require("./services/storageService");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Bes backend running on port ${PORT}`);
});

// Uploaded evidence must survive redeploys (Railway: STORAGE_DIR = a mounted
// Volume). The volume id is stable across deploys only if storage persists.
const storage = checkStorageDurability();
if (storage.durable) {
  console.log(`Evidence storage OK (volume id ${storage.volumeId})`);
} else {
  const log = process.env.NODE_ENV === "production" ? console.error : console.warn;
  log(`STORAGE NOT DURABLE: ${storage.problems.join("; ")}${storage.volumeId ? ` (volume id ${storage.volumeId})` : ""}`);
}

// Daily housekeeping (process entry point only — never runs in tests): purge
// consent records past the retention window, reconcile alert texts left
// `reserved` by a crash (never re-sent — see smsDispatchService), and drop
// Live View link rows that expired over 30 days ago.
const DAY_MS = 24 * 60 * 60 * 1000;
async function smsMaintenance() {
  try {
    const purged = await purgeExpiredConsentEvents();
    const reconciled = await sweepStaleReservations();
    const links = await purgeExpiredLinks();
    if (purged || reconciled || links) {
      console.log(`Maintenance: purged ${purged} consent records, reconciled ${reconciled} texts, removed ${links} expired live-view links`);
    }
  } catch (error) {
    console.error("Maintenance failed:", error?.message || error);
  }
}
setTimeout(smsMaintenance, 60 * 1000).unref();
setInterval(smsMaintenance, DAY_MS).unref();
