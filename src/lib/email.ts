import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export interface JobStats {
  totalUrls: number;
  completedUrls: number;
  failedUrls: number;
  appUrl: string;
}

export async function sendCompletionEmail(to: string, stats: JobStats) {
  const { totalUrls, completedUrls, failedUrls, appUrl } = stats;

  const { data, error } = await resend.emails.send({
    from: "DISCERN Insights <onboarding@resend.dev>",
    to,
    subject: "✅ Sua análise DISCERN foi concluída!",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #f9f9f9; border-radius: 8px;">
        <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 8px;">Análise concluída! 🎉</h1>
        <p style="color: #555; font-size: 16px;">Seu processamento em segundo plano foi finalizado.</p>

        <div style="background: #fff; border-radius: 8px; padding: 24px; margin: 24px 0; border: 1px solid #e5e5e5;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #555; font-size: 14px;">Total de URLs</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #1a1a1a;">${totalUrls}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #555; font-size: 14px;">✅ Analisadas com sucesso</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #16a34a;">${completedUrls}</td>
            </tr>
            ${
              failedUrls > 0
                ? `<tr>
              <td style="padding: 8px 0; color: #555; font-size: 14px;">❌ Falhas</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #dc2626;">${failedUrls}</td>
            </tr>`
                : ""
            }
          </table>
        </div>

        <a href="${appUrl}/dashboard" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
          Ver resultados →
        </a>
        
        <p style="color: #999; font-size: 12px; margin-top: 32px;">
          DISCERN Insights · Você recebeu este email porque solicitou análise em segundo plano.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("Resend email failed:", error);
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  return data;
}
