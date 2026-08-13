class EmergencyPage {
  get countdownScreen() {
    return $('~emergency-countdown-screen');
  }

  get countdownNumber() {
    return $('~emergency-countdown-number');
  }

  get cancelBtn() {
    return $('~emergency-cancel-btn');
  }

  get liveScreen() {
    return $('~emergency-live-screen');
  }

  get cameraPanel() {
    return $('~emergency-camera-panel');
  }

  get cameraView() {
    return $('~emergency-camera-view');
  }

  get cameraFallback() {
    return $('~emergency-camera-fallback');
  }

  get recLabel() {
    return $('~emergency-rec-label');
  }

  get gpsText() {
    return $('~emergency-gps-text');
  }

  get statusText() {
    return $('~emergency-status-text');
  }

  get call911Btn() {
    return $('~emergency-call911-btn');
  }

  get stopBtn() {
    return $('~emergency-stop-btn');
  }

  get exitBtn() {
    return $('~emergency-exit-btn');
  }

  // A system "Location Accuracy" dialog (a Google Play Services nudge,
  // separate from the standard runtime permission grant) can pop up the
  // moment location is requested, covering the whole screen — dismiss it
  // by accepting ("Turn on"), since declining leaves location settings
  // unsatisfied and the real GPS lookup fails later.
  async dismissLocationAccuracyDialogIfPresent() {
    const turnOnBtn = await $('//*[@text="Turn on"]');
    if (await turnOnBtn.isExisting()) {
      await turnOnBtn.click();
      await driver.pause(500);
      return true;
    }
    return false;
  }

  async waitForLiveScreen(timeoutMs) {
    await driver.waitUntil(
      async () => {
        await this.dismissLocationAccuracyDialogIfPresent();
        return this.liveScreen.isDisplayed();
      },
      { timeout: timeoutMs, interval: 500, timeoutMsg: 'Live screen never appeared' },
    );
  }

  async waitForRecordingPhase(timeoutMs = 15000) {
    await driver.waitUntil(
      async () => (await this.recLabel.getText()).startsWith('LIVE'),
      { timeout: timeoutMs, timeoutMsg: 'Emergency never reached the recording phase' },
    );
  }
}

module.exports = new EmergencyPage();
