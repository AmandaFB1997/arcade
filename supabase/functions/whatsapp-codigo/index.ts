// "Send SMS Hook" do Supabase Auth: em vez de SMS, manda o código de 6 dígitos pelo WhatsApp,
// usando o servidor afbtech-whatsapp (Railway) pela rota segura /servico/conclave/codigo.
// Ligar em: Authentication → Auth Hooks → Send SMS hook → HTTPS → URL desta função. O Supabase gera o segredo (v1,whsec_...).
// Segredos desta função: SEND_SMS_HOOK_SECRET e CONCLAVE_SEGREDO (o MESMO valor que está no Railway).
// Opcional: AFB_WHATSAPP_URL (padrão abaixo).
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

async function enviarWhatsApp(telefone: string, texto: string) {
  const base = (Deno.env.get('AFB_WHATSAPP_URL') ?? 'https://afbtech-whatsapp-production.up.railway.app').replace(/\/+$/, '');
  const r = await fetch(`${base}/servico/conclave/codigo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('CONCLAVE_SEGREDO') ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ telefone: telefone.replace(/\D/g, ''), texto }),
  });
  if (!r.ok) throw new Error(`Servidor de WhatsApp respondeu ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  const bruto = await req.text();
  let carga: { user: { phone: string }; sms: { otp: string } };
  try {
    const segredo = Deno.env.get('SEND_SMS_HOOK_SECRET')!.replace('v1,whsec_', '');
    carga = new Webhook(segredo).verify(bruto, Object.fromEntries(req.headers)) as typeof carga;
  } catch {
    return new Response(JSON.stringify({ error: { http_code: 401, message: 'assinatura inválida' } }), { status: 401 });
  }
  try {
    await enviarWhatsApp(carga.user.phone, `O Conclave: seu código de acesso é *${carga.sms.otp}*. Ele vale por poucos minutos. Não compartilhe.`);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: { http_code: 500, message: 'não foi possível enviar o código' } }), { status: 500 });
  }
});
