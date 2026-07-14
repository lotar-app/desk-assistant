const MigrationUtils = {

  clone(value) {
    return JSON.parse(JSON.stringify(value));
  },

  normalizeValue(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return value.toISOString();
    }

    if (value === undefined || value === null) {
      return "";
    }

    return value;
  },

  canonicalize(value) {
    if (Array.isArray(value)) {
      return value.map(item => this.canonicalize(item));
    }

    if (value && typeof value === "object") {
      const normalized = {};

      Object.keys(value).sort().forEach(key => {
        normalized[key] = this.canonicalize(value[key]);
      });

      return normalized;
    }

    return this.normalizeValue(value);
  },

  checksum(value) {
    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify(this.canonicalize(value)),
      Utilities.Charset.UTF_8
    );

    return bytes
      .map(byte => (byte < 0 ? byte + 256 : byte))
      .map(byte => ("0" + byte.toString(16)).slice(-2))
      .join("");
  },

  valuesEqual(left, right) {
    return JSON.stringify(this.canonicalize(left)) ===
      JSON.stringify(this.canonicalize(right));
  },

  verifyChecksum(value, checksum) {
    const copy = this.clone(value);
    delete copy.checksum;
    return this.checksum(copy) === checksum;
  },

  matches(record, selector) {
    return Object.keys(selector || {}).every(key => (
      this.valuesEqual(record[key], selector[key])
    ));
  }

};
