const token = process.env.NODE_AUTH_TOKEN ?? "";
const reasons = [];

if (token.length === 0) {
  reasons.push("missing");
}
if (token !== token.trim()) {
  reasons.push("surrounding-whitespace");
}
if (/[^\x20-\x7e]/u.test(token)) {
  reasons.push("non-printable-character");
}
if (token.length > 0 && !/^npm_[A-Za-z0-9_-]+$/u.test(token)) {
  reasons.push("unexpected-format");
}
if (token.length > 0 && (token.length < 20 || token.length > 256)) {
  reasons.push("unexpected-length");
}

const report = JSON.stringify({ length: token.length, reasons });
if (reasons.length > 0) {
  console.error(`npm auth token preflight failed ${report}`);
  process.exitCode = 1;
} else {
  console.log(`npm auth token preflight passed ${report}`);
}
