import { z } from "zod";

const shortOptionalString = z.string().trim().max(500).optional();

export const capturedEventSchema = z.object({
  type: z.string().trim().min(1).max(200).default("Error"),
  message: z.string().trim().min(1).max(2_000),
  stack: z.string().max(50_000).optional(),
  timestamp: z.iso.datetime().optional(),
  release: shortOptionalString,
  environment: shortOptionalString,
  url: z.string().trim().max(2_048).optional(),
  userAgent: z.string().trim().max(2_048).optional(),
  browser: z
    .object({
      name: z.string().trim().min(1).max(100),
      version: z.string().trim().max(100).optional(),
      engine: z.string().trim().min(1).max(100),
      operatingSystem: z.string().trim().min(1).max(100),
      deviceType: z.enum(["Desktop", "Mobile", "Tablet"])
    })
    .optional(),
  userId: z.string().trim().max(500).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  breadcrumbs: z
    .array(
      z.object({
        type: z.string().trim().min(1).max(100),
        message: z.string().trim().min(1).max(500),
        timestamp: z.iso.datetime()
      })
    )
    .max(50)
    .optional()
});

export const statusUpdateSchema = z.object({
  status: z.enum(["unresolved", "resolved", "ignored"])
});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(2).max(100)
});

export const demoCheckoutSchema = z.object({
  scenario: z.enum([
    "success",
    "payment-declined",
    "gateway-down",
    "malformed-response",
    "timeout",
    "out-of-stock",
    "session-expired",
    "invalid-coupon"
  ]),
  product: z.string().trim().min(1).max(200),
  paymentMethod: z.enum(["bKash", "Card", "Cash on delivery"]),
  customerId: z.string().trim().min(1).max(100)
});
