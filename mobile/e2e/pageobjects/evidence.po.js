class EvidencePage {
  get screen() {
    return $('~evidence-screen');
  }

  get emptyState() {
    return $('~evidence-empty-state');
  }

  get cards() {
    return $$('~evidence-card');
  }
}

module.exports = new EvidencePage();
