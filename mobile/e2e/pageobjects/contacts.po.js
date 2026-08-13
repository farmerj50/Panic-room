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

  async addContact(name, phone) {
    if (!(await this.nameInput.isDisplayed().catch(() => false))) {
      await this.addToggleBtn.click();
    }
    await this.nameInput.waitForDisplayed({ timeout: 10000 });
    await this.nameInput.setValue(name);
    await this.phoneInput.setValue(phone);
    await this.saveBtn.click();
  }
}

module.exports = new ContactsPage();
