class OnboardingPage {
  get welcomeCta() {
    return $('~onboarding-welcome-cta');
  }

  get cameraSkip() {
    return $('~onboarding-camera-skip');
  }

  get microphoneSkip() {
    return $('~onboarding-microphone-skip');
  }

  get locationSkip() {
    return $('~onboarding-location-skip');
  }

  get completeCta() {
    return $('~onboarding-complete-cta');
  }

  // Drives through the whole post-registration onboarding stack, declining
  // every permission via "Not now" — deterministic and dialog-free (skip
  // resolves as 'denied' without ever invoking the OS permission prompt or
  // our own in-app disclosure Alert), matching how the pre-onboarding e2e
  // flow never actually exercised the grant path either.
  //
  // New signups are randomly split 50/50 (services/experiments.ts) between
  // this onboarding stack and the 'contextual' variant, which skips it and
  // lands straight on Home. Either way, Home then shows the one-time
  // "Welcome to Bes — Take the Tour" offer card, which blocks every tap
  // until dismissed — so this handles both variants and always declines
  // the tour.
  async skipAll() {
    let sawWelcome = false;
    await driver.waitUntil(
      async () => {
        sawWelcome = await this.welcomeCta.isDisplayed();
        return sawWelcome || (await this.tourSkipBtn.isDisplayed()) || (await $('~tab-emergency-btn').isDisplayed());
      },
      { timeout: 30000, interval: 500, timeoutMsg: 'Neither onboarding, the tour offer, nor Home appeared after sign-up' },
    );

    if (sawWelcome) await this.skipOnboardingStack();
    await this.dismissTourOfferIfPresent();
  }

  // Tour buttons set testID only, which Android exposes as resource-id.
  get tourSkipBtn() {
    return $('android=new UiSelector().resourceId("tour-skip-btn")');
  }

  async dismissTourOfferIfPresent(timeoutMs = 10000) {
    try {
      await this.tourSkipBtn.waitForDisplayed({ timeout: timeoutMs });
    } catch {
      return false; // already offered/declined for this account
    }
    await this.tourSkipBtn.click();
    await this.tourSkipBtn.waitForDisplayed({ timeout: 10000, reverse: true });
    return true;
  }

  async skipOnboardingStack() {
    await this.welcomeCta.click();

    await this.cameraSkip.waitForDisplayed({ timeout: 10000 });
    await this.cameraSkip.click();

    await this.microphoneSkip.waitForDisplayed({ timeout: 10000 });
    await this.microphoneSkip.click();

    await this.locationSkip.waitForDisplayed({ timeout: 10000 });
    await this.locationSkip.click();

    await this.completeCta.waitForDisplayed({ timeout: 10000 });
    await this.completeCta.click();
  }
}

module.exports = new OnboardingPage();
