// "Send SMS Hook" do Supabase Auth: em vez de SMS, manda o código de 6 dígitos pelo WhatsApp.
// Ligar em: Authentication → Auth Hooks → Send SMS hook → HTTPS → URL desta função. O Supabase gera o segredo (v1,whsec_...).
// Segredos: SEND_SMS_HOOK_SECRET, WHATSAPP_API_URL, WHATSAPP_API_TOKEN.
// ⚠️ AJUSTE a função enviarWhatsApp() ao formato da API do seu servidor de WhatsApp.
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

async function enviarWhatsApp(telefone: string, texto: string) {
  const r = await fetch(Deno.env.get('WHATSAPP_API_URL')!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('WHATSAPP_API_TOKEN')}` },
    body: JSON.stringify({ number: telefone.replace(/\D/g, ''), message: texto }),   // ← formato do SEU servidor
  });
  if (!r.ok) throw new Error(`WhatsApp respondeu ${r.status}`);
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
