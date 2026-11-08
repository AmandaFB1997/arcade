// O Mercado Pago avisa aqui quando um PIX muda de estado. NÃO confiamos no aviso: consultamos o pagamento
// direto na API do Mercado Pago e só então creditamos. DESLIGUE "Verify JWT" desta função (o MP não manda login).
// Segredos: MP_ACCESS_TOKEN (obrigatório) e MP_WEBHOOK_SECRET (opcional: assinatura do painel do Mercado Pago).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

async function assinaturaValida(req: Request, dataId: string): Promise<boolean> {
  const segredo = Deno.env.get('MP_WEBHOOK_SECRET');
  if (!segredo) return true;                                       // sem segredo configurado, a consulta à API já protege
  const sig = req.headers.get('x-signature') ?? '';
  const ts = /ts=([^,]+)/.exec(sig)?.[1]; const v1 = /v1=([^,]+)/.exec(sig)?.[1];
  if (!ts || !v1) return false;
  const modelo = `id:${dataId.toLowerCase()};request-id:${req.headers.get('x-request-id') ?? ''};ts:${ts};`;
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(modelo)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === v1;
}

Deno.serve(async (req) => {
  try {
    const u = new URL(req.url);
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* aviso sem corpo */ }
    const tipo = corpo?.type ?? u.searchParams.get('type') ?? u.searchParams.get('topic');
    const id = String(corpo?.data?.id ?? u.searchParams.get('data.id') ?? u.searchParams.get('id') ?? '');
    if (tipo !== 'payment' || !id) return new Response('ignorado', { status: 200 });
    if (!(await assinaturaValida(req, id))) return new Response('assinatura inválida', { status: 401 });

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${Deno.env.get('MP_ACCESS_TOKEN')}` },
    });
    if (!r.ok) return new Response('erro ao consultar pagamento', { status: 502 });   // o MP tenta de novo
    const pag = await r.json();
    if (pag.status !== 'approved' || !pag.external_reference) return new Response('sem ação', { status: 200 });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await admin.rpc('confirmar_recarga_pix', {
      _pedido: pag.external_reference, _id_externo: String(pag.id), _valor_reais: pag.transaction_amount,
    });
    if (error) { console.error('confirmar_recarga_pix', error.message); return new Response('erro', { status: 500 }); }
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response('erro', { status: 500 });
  }
});
