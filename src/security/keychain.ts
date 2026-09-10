const ACCOUNT = "paper-reading-assistant@local";
const DEEPSEEK_SERVICE = "com.openai.paper-reading-assistant.deepseek-api-key";

export async function readDeepSeekApiKey(): Promise<string> {
  try {
    const value = await Zotero.Utilities.Internal.subprocess("/usr/bin/security", [
      "find-generic-password",
      "-a", ACCOUNT,
      "-s", DEEPSEEK_SERVICE,
      "-w",
    ]);
    const key = String(value).trim();
    if (!key) throw new Error("empty key");
    return key;
  } catch (error) {
    Zotero.logError(error);
    throw new Error("未在 macOS 钥匙串中找到 DeepSeek API Key");
  }
}
