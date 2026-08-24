import nodemailer from "nodemailer";

export interface AccountEmailSender {
  sendEmailVerification(input: { name: string; email: string; verificationUrl: string }): Promise<void>;
  sendPasswordReset(input: { name: string; email: string; resetUrl: string }): Promise<void>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    };
    return entities[character] ?? character;
  });
}

function emailDocument(heading: string, message: string, buttonLabel: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return [
    "<!doctype html><html><body style=\"margin:0;background:#f4f5f2;font-family:Arial,sans-serif;color:#18201b\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\"><tr><td style=\"padding:36px 16px\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:560px;margin:auto;background:#fff;border:1px solid #dfe3de;border-radius:10px\">",
    "<tr><td style=\"padding:28px 30px 14px;font-size:18px;font-weight:700\">CrashLens</td></tr>",
    "<tr><td style=\"padding:8px 30px 30px\"><h1 style=\"margin:0 0 12px;font-size:24px\">" + escapeHtml(heading) + "</h1>",
    "<p style=\"margin:0 0 22px;color:#59635c;line-height:1.6\">" + escapeHtml(message) + "</p>",
    "<a href=\"" + safeUrl + "\" style=\"display:inline-block;padding:12px 17px;border-radius:6px;background:#236345;color:#fff;text-decoration:none;font-weight:700\">" + escapeHtml(buttonLabel) + "</a>",
    "<p style=\"margin:22px 0 0;color:#7a837d;font-size:12px;line-height:1.5\">If the button does not work, copy this link:<br><span style=\"word-break:break-all\">" + safeUrl + "</span></p>",
    "</td></tr></table></td></tr></table></body></html>"
  ].join("");
}

export function createAccountEmailSenderFromEnv(): AccountEmailSender | null {
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !password) return null;

  const port = Number(process.env.SMTP_PORT ?? "465");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user, pass: password }
  });
  const from = process.env.EMAIL_FROM?.trim() || user;

  return {
    async sendEmailVerification({ name, email, verificationUrl }) {
      await transport.sendMail({
        from: "CrashLens <" + from + ">",
        to: email,
        subject: "Verify your CrashLens email",
        text: "Hi " + name + ", verify your CrashLens email: " + verificationUrl + " This link expires in one hour.",
        html: emailDocument(
          "Verify your email",
          "Hi " + name + ", confirm this email address to finish creating your CrashLens workspace. This link expires in one hour.",
          "Verify email",
          verificationUrl
        )
      });
    },

    async sendPasswordReset({ name, email, resetUrl }) {
      await transport.sendMail({
        from: "CrashLens <" + from + ">",
        to: email,
        subject: "Reset your CrashLens password",
        text: "Hi " + name + ", reset your CrashLens password: " + resetUrl + " This link expires in 30 minutes.",
        html: emailDocument(
          "Reset your password",
          "Hi " + name + ", use this secure link to choose a new CrashLens password. This link expires in 30 minutes.",
          "Reset password",
          resetUrl
        )
      });
    }
  };
}
