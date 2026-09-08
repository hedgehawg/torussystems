#!/usr/bin/env node
"use strict";

const crypto = require("crypto");

const password = process.argv[2];
if (!password) {
  console.error("Usage: node hash-password.js <password>");
  console.error("Prints the SHA-256 hex digest to paste into config.js");
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(password, "utf8").digest("hex");
console.log(hash);
