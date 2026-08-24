import { createHmac } from "node:crypto";
import type { Alert } from "./domain.js";
import type { IssueRepository } from "./repository.js";

export interface AlertDeliveryOptions {
  webhookUrl?: string;
  webhookSecret?: string;
}

export async function deliverAlert(
  repository: IssueRepository,
  alert: Alert,
  options: AlertDeliveryOptions
): Promise<void> {
  if (!options.webhookUrl) return;

  const body = JSON.stringify({ source: "crashlens", alert });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.webhookSecret) {
    headers["x-crashlens-signature"] = createHmac("sha256", options.webhookSecret)
      .update(body)
      .digest("hex");
  }

  try {
    const response = await fetch(options.webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(3_000)
    });
    await repository.updateAlertDelivery(alert.id, response.ok ? "delivered" : "failed");
  } catch {
    await repository.updateAlertDelivery(alert.id, "failed");
  }
}
