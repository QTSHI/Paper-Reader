import type { GenerationRequest, GenerationResponse, ModelProvider, ProviderHealth } from "../domain/types";

interface OpenAIProviderOptions {
  apiKey: string;
  endpoint: string;
}

function outputText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("The model response did not contain output text");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAIProvider implements ModelProvider {
  readonly id = "openai";

  constructor(private readonly options: OpenAIProviderOptions) {}

  async validateConfiguration(): Promise<ProviderHealth> {
    if (!this.options.apiKey.trim()) return { ok: false, message: "尚未配置 OpenAI API Key" };
    if (!this.options.endpoint.startsWith("https://")) return { ok: false, message: "API 地址必须使用 HTTPS" };
    return { ok: true, message: "配置格式有效，尚未发起计费请求" };
  }

  async generate<T>(request: GenerationRequest<T>): Promise<GenerationResponse<T>> {
    const payload = {
      model: request.model,
      store: false,
      instructions: request.instructions,
      input: request.input,
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          strict: true,
          schema: request.schema,
        },
      },
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await Zotero.HTTP.request("POST", this.options.endpoint, {
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          responseType: "json",
          timeout: request.timeoutMs ?? 120_000,
        });
        const body = response.responseJSON ?? JSON.parse(response.responseText);
        const parsed = request.parse(JSON.parse(outputText(body)));
        return {
          data: parsed,
          responseId: body.id ?? "",
          model: body.model ?? request.model,
          inputTokens: body.usage?.input_tokens ?? 0,
          outputTokens: body.usage?.output_tokens ?? 0,
        };
      } catch (error: any) {
        lastError = error;
        const status = Number(error?.status ?? error?.xmlhttp?.status ?? 0);
        const retryable = status === 0 || status === 429 || status >= 500;
        if (!retryable || attempt === 2) break;
        await delay(500 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("OpenAI request failed");
  }
}
