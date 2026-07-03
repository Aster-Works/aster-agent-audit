import { spawn } from "node:child_process";

/** Best-effort: open a URL in the default browser. Never throws. */
export function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const cmd =
      platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* headless or no opener available — ignore */
  }
}
