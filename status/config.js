/* Status page config — committed hash only, never a plaintext password.
   passwordSha256 is the SHA-256 hex of the unlock password (see STATUS.md). */
window.STATUS_CONFIG = {
  passwordSha256:
    "d1f48fd360295c3b90d28d462024f86709a225cc02c5d4d5470a3e365164df18",
  dataUrl: "data.json",
  refreshMs: 20000
};
