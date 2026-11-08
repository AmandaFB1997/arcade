// Cria o PIX de uma recarga no Mercado Pago e grava o pedido. Chamada pelo app do cliente (logado).
// Segredos necessários: MP_ACCESS_TOKEN (SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já existem).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN');
    if (!mpToken) return json({ erro: 'PIX ainda não configurado.' }, 503);

    const doUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await doUsuario.auth.getUser();
    if (!user) return json({ erro: 'Faça login de novo.' }, 401);

    const { pacote_id } = await req.json();
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: pacote } = await admin.from('pacotes_recarga').select('*').eq('id', pacote_id).eq('ativo', true).maybeSingle();
    if (!pacote) return json({ erro: 'Pacote indisponível.' }, 400);

    const expira = new Date(Date.now() + 30 * 60 * 1000);
    const { data: pedido, error: e1 } = await admin.from('pedidos_recarga').insert({
      usuario_id: user.id, pacote_id: pacote.id, valor_reais: pacote.valor_reais, valor_ac: pacote.valor_ac,
      expira_em: expira.toISOString(),
    }).select('id').single();
    if (e1) throw e1;

    // O Mercado Pago pede a data com fuso; mandamos em -03:00 (Brasília)
    const dataExp = new Date(expira.getTime() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00');
    const r = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': pedido.id },
      body: JSON.stringify({
        transaction_amount: Number(pacote.valor_reais),
        description: `O Conclave — recarga ${pacote.nome}`,
        payment_method_id: 'pix',
        payer: { email: user.email ?? 'cliente@oconclave.com.br' },
        external_reference: pedido.id,
        notification_url: `${url}/functions/v1/webhook-pix`,
        date_of_expiration: dataExp,
      }),
    });
    const pag = await r.json();
    if (!r.ok || !pag?.point_of_interaction?.transaction_data?.qr_code) {
      await admin.from('pedidos_recarga').update({ status: 'cancelado' }).eq('id', pedido.id);
      console.error('Mercado Pago recusou', JSON.stringify(pag));
      return json({ erro: 'Não foi possível gerar o PIX agora. Tente de novo.' }, 502);
    }
    const td = pag.point_of_interaction.transaction_data;
    await admin.from('pedidos_recarga').update({
      id_externo: String(pag.id), pix_copia_cola: td.qr_code, pix_qr_base64: td.qr_code_base64,
    }).eq('id', pedido.id);

    return json({ pedido_id: pedido.id, pix_copia_cola: td.qr_code, pix_qr_base64: td.qr_code_base64,
                  expira_em: expira.toISOString(), valor_reais: pacote.valor_reais, valor_ac: pacote.valor_ac });
  } catch (e) {
    console.error(e);
    return json({ erro: 'Erro inesperado.' }, 500);
  }
});
