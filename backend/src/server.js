const app = require("./app");
const { purgeExpiredConsentEvents } = require("./services/smsConsentService");
const { sweepStaleReservations } = require("./services/smsDispatchService");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Bes backend running on port ${PORT}`);
});

// Daily SMS housekeeping (process entry point only — never runs in tests):
// purge consent records past the retention window, and reconcile alert
// texts left `reserved` by a crash (never re-sent — see smsDispatchService).
const DAY_MS = 24 * 60 * 60 * 1000;
async function smsMaintenance() {
  try {
    const purged = await purgeExpiredConsentEvents();
    const reconciled = await sweepStaleReservations();
    if (purged || reconciled) console.log(`SMS maintenance: purged ${purged}, reconciled ${reconciled}`);
  } catch (error) {
    console.error("SMS maintenance failed:", error?.message || error);
  }
}
setTimeout(smsMaintenance, 60 * 1000).unref();
setInterval(smsMaintenance, DAY_MS).unref();
