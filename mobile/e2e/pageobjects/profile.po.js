class ProfilePage {
  get contactsBtn() {
    return $('~profile-contacts-btn');
  }

  get evidenceBtn() {
    return $('~profile-evidence-btn');
  }

  get logoutBtn() {
    return $('~profile-logout-btn');
  }

  get premiumBtn() {
    return $('~profile-premium-btn');
  }

  // The Bes Premium section pushed everything below it further down the
  // page than it used to be — rows that previously fit on-screen (Trusted
  // Contacts, Evidence, Sign Out) now need a scroll to reach on a phone-
  // sized viewport. Coordinate-based `mobile: swipeGesture` (the pattern
  // used elsewhere in this suite) does not reliably scroll this screen —
  // its swipe path crosses nested touchables in the hero card, which
  // appears to swallow the gesture before it reaches the ScrollView.
  // `mobile: scrollGesture`'s `percent` scales with the *entire* scrollable
  // content height, not a fixed step — on this now-tall page even a small
  // percent is a huge jump that can skip clean over the target between
  // checks. A raw W3C pointer drag moves a fixed pixel distance regardless
  // of content height, so it's used here instead for small, predictable
  // increments.
  async scrollDownStep() {
    await driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: 540, y: 1900 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration: 300, x: 540, y: 900 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
    await driver.releaseActions();
    await driver.pause(250);
  }

  async scrollUpStep() {
    await driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: 540, y: 900 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration: 300, x: 540, y: 1900 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
    await driver.releaseActions();
    await driver.pause(250);
  }

  async scrollToElement(selector, { maxSwipes = 12 } = {}) {
    for (let i = 0; i < maxSwipes; i++) {
      const el = await $(selector);
      if (await el.isDisplayed().catch(() => false)) {
        await driver.pause(400);
        return el;
      }
      await this.scrollDownStep();
    }
    return $(selector);
  }

  // Even a just-confirmed-displayed element can throw "element wasn't
  // found" on click (observed on this emulator under software rendering —
  // a real UiAutomator2/device-under-load race, not the app misbehaving),
  // so retry the click itself a few times against a fresh lookup rather
  // than trusting one resolved reference.
  async scrollToElementAndClick(selector, opts) {
    await this.scrollToElement(selector, opts);
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        await (await $(selector)).click();
        return;
      } catch (err) {
        lastErr = err;
        await driver.pause(500);
      }
    }
    throw lastErr;
  }
}

module.exports = new ProfilePage();
