/* Status page config — committed hash only, never a plaintext password.
   Default hash is SHA-256 of the development password `torus-dev`.
   Replace STATUS_PASSWORD_SHA256 before going live (see STATUS.md). */
window.STATUS_CONFIG = {
  passwordSha256:
    "69f2ea6734ef04fcc021c5e8b96e2968b5585be35f55e1802bc7150bf6f28e77",
  dataUrl: "data.json",
  refreshMs: 20000
};
