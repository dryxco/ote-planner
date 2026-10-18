// Who owns the data for a request. Single-user for now: every device shares one data set.
// Login (sign-in / Tailscale identity) will plug in here and key the data per user.
export function dataOwner(request: Request): string {
  void request;
  return "default";
}
