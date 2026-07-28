import fs from "fs";

export interface EnvironmentInfo {
  type: string;
  sandboxId: string;
}

export function detectEnvironment(): EnvironmentInfo {
  // 1. Check env var
  if (process.env.CONWAY_SANDBOX_ID) {
    const sandboxId = process.env.CONWAY_SANDBOX_ID.trim();
    if (sandboxId) {
      return { type: "conway-sandbox", sandboxId };
    }
  }

  // 2. Check sandbox config file
  try {
    if (fs.existsSync("/etc/conway/sandbox.json")) {
      const data = JSON.parse(fs.readFileSync("/etc/conway/sandbox.json", "utf-8"));
      if (data.id) {
        const sandboxId = String(data.id).trim();
        if (sandboxId) {
          return { type: "conway-sandbox", sandboxId };
        }
      }
    }
  } catch {}

  // 3. Check Docker
  if (fs.existsSync("/.dockerenv")) {
    return { type: "docker", sandboxId: "" };
  }

  // 4. Fall back to platform (Termux on Android reports "android")
  const platform = process.platform;
  if (platform === "android" || process.env.PREFIX?.includes("/com.termux/")) {
    return { type: "termux", sandboxId: "" };
  }
  return { type: platform, sandboxId: "" };
}
