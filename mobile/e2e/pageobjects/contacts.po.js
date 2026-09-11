class ContactsPage {
  get screen() {
    return $('~contacts-screen');
  }

  get emptyState() {
    return $('~contacts-empty-state');
  }

  get addToggleBtn() {
    return $('~contacts-add-toggle-btn');
  }

  get nameInput() {
    return $('~contacts-name-input');
  }

  get phoneInput() {
    return $('~contacts-phone-input');
  }

  get saveBtn() {
    return $('~contacts-save-btn');
  }

  get rows() {
    return $$('~contacts-row');
  }

  // Each row's accessibility label is the same static "contacts-row" (the
  // convention this codebase uses throughout), so a specific contact is
  // found by its visible name text instead of a unique per-row identifier.
  rowByName(name) {
    return $(`//*[@text="${name}"]`);
  }

  // The contact-limit indicator text added above pushed the add-contact
  // form far enough down that it can start below the fold on a phone-sized
  // viewport, even when it's already open (showAdd defaults true for a
  // fresh/empty account) — without scrolling first, isDisplayed() below
  // would read false and this would wrongly tap addToggleBtn, which
  // *closes* an already-open form instead of opening a closed one.
  // `mobile: scrollGesture`'s `percent` scales with the entire scrollable
  // content height, not a fixed step, so a raw W3C pointer drag (a fixed
  // pixel distance regardless of content height) is used for small,
  // predictable increments instead.
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

  async scrollToTop({ maxSwipes = 12 } = {}) {
    for (let i = 0; i < maxSwipes; i++) {
      await this.scrollUpStep();
    }
  }

  async addContact(name, phone) {
    // isExisting() (not isDisplayed()) decides whether the form needs
    // opening — nameInput isn't in the tree at all when the form is
    // closed, but scrolling first (per scrollToElement) to look for it
    // would exhaust the whole page hunting for something that isn't
    // there, ending up scrolled past addToggleBtn with no way back except
    // scrolling up. isExisting() works regardless of current scroll
    // position, so it correctly tells "closed" (not existing) apart from
    // "open but off-screen" (existing, not displayed) up front.
    // A single isExisting() check right after navigating can be a false
    // negative (the off-screen part of the tree isn't attached/measured
    // yet under software rendering) — retry briefly before concluding the
    // form really is closed.
    let formExists = false;
    for (let i = 0; i < 3 && !formExists; i++) {
      formExists = await this.nameInput.isExisting().catch(() => false);
      if (!formExists) await driver.pause(400);
    }
    if (!formExists) {
      await this.scrollToElementAndClick('~contacts-add-toggle-btn');
    }
    await this.scrollToElement('~contacts-name-input');
    await this.nameInput.waitForDisplayed({ timeout: 10000 });
    await this.nameInput.setValue(name);
    await this.phoneInput.setValue(phone);
    await this.saveBtn.click();
  }
}

module.exports = new ContactsPage();
