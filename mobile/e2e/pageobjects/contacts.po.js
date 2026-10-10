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
  // Scoped to saved list rows: an unscoped text match also hits the name
  // still typed in the add form after a rejected save (false "row exists").
  rowSelector(name) {
    return `//*[@content-desc="contacts-row"]//*[@text="${name}"]`;
  }

  rowByName(name) {
    return $(this.rowSelector(name));
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
    // The toggle's own arrow is the authoritative open/closed state
    // ('v' = open, '>' = closed). Probing for nameInput instead (the old
    // approach) false-negatived on a fresh account, whose form starts open,
    // and the toggle tap then CLOSED it. scrollToElement accepts the toggle
    // once its top edge is on-screen, but the arrow sits lower and is
    // clipped out of the tree until the whole card is visible — so keep
    // scrolling until the arrow itself is present before deciding.
    const toggle = await this.scrollToElement('~contacts-add-toggle-btn');
    const arrowCount = async (glyph) => (await toggle.$$(`.//*[@text="${glyph}"]`).length);
    for (let i = 0; i < 4 && (await arrowCount('v')) + (await arrowCount('>')) === 0; i++) {
      await this.scrollDownStep();
    }
    const isOpen = async () => (await arrowCount('v')) > 0;
    if (!(await isOpen())) {
      await toggle.click();
      await driver.waitUntil(isOpen, { timeout: 5000, timeoutMsg: 'add-contact form did not open' });
    }
    await this.scrollToElement('~contacts-name-input');
    await this.nameInput.waitForDisplayed({ timeout: 10000 });
    await this.nameInput.setValue(name);
    await this.phoneInput.setValue(phone);
    await this.saveBtn.click();
    await this.dismissSmsInviteOfferIfPresent();
  }

  // After a contact is saved, the app offers to send them an SMS consent
  // invite ("Turn on emergency texts?"). Decline it so specs continue on
  // the Contacts screen; the invite flow itself is covered elsewhere.
  async dismissSmsInviteOfferIfPresent(timeoutMs = 6000) {
    const notNow = $('//*[@text="Not now" or @text="NOT NOW"]');
    try {
      await notNow.waitForDisplayed({ timeout: timeoutMs });
      await notNow.click();
    } catch {
      // Save failed (e.g. invalid number) — no offer was shown.
    }
  }
}

module.exports = new ContactsPage();
