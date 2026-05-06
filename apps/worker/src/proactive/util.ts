export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
