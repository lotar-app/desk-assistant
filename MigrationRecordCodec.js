const MigrationRecordCodec = {

  encode(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return {
        __deskMigrationType: "DATE",
        value: value.toISOString()
      };
    }

    if (Array.isArray(value)) {
      return value.map(item => this.encode(item));
    }

    if (value && typeof value === "object") {
      const encoded = {};
      Object.keys(value).forEach(key => {
        encoded[key] = this.encode(value[key]);
      });
      return encoded;
    }

    return value === undefined || value === null ? "" : value;
  },

  decode(value) {
    if (
      value &&
      typeof value === "object" &&
      value.__deskMigrationType === "DATE"
    ) {
      return new Date(value.value);
    }

    if (Array.isArray(value)) {
      return value.map(item => this.decode(item));
    }

    if (value && typeof value === "object") {
      const decoded = {};
      Object.keys(value).forEach(key => {
        decoded[key] = this.decode(value[key]);
      });
      return decoded;
    }

    return value;
  }

};
