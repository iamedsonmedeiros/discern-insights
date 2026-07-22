// src/lib/queue.ts
//
// Thin wrapper over QStash so both fan-out stages (job -> extract, extract ->
// one message per model) publish the same way, with the same local-dev fallback.

import "server-only";

import { Client } from "@upstash/qstash";

export type QueueMessage = {
  path: string; // e.g. "/api/worker/analyze"
  body: Record<string, unknown>;
  delaySeconds?: number;
};

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
}

/**
 * Publishes a batch of worker messages. With no QSTASH_TOKEN (local dev) the
 * workers are invoked directly, fire-and-forget, so the pipeline still runs.
 */
export async function publish(messages: QueueMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const base = appUrl();

  if (process.env.QSTASH_TOKEN) {
    const qstash = new Client({ token: process.env.QSTASH_TOKEN });
    await qstash.batchJSON(
      messages.map((message) => ({
        url: `${base}${message.path}`,
        body: message.body,
        delay: message.delaySeconds,
        retries: 2,
      }))
    );
    return;
  }

  for (const message of messages) {
    fetch(`${base}${message.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dev-bypass": "1" },
      body: JSON.stringify(message.body),
    }).catch((e) => console.error(`Direct worker call to ${message.path} failed:`, e));
  }
}
