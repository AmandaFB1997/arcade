// Cria (ou atualiza) o acesso de um funcionário: e-mail + senha + papel. Só administrador pode chamar.
// Não precisa de segredo novo: SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já existem.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const PAPEIS = ['admin', 'garcom', 'cozinha'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const doUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await doUsuario.auth.getUser();
    if (!user) return json({ erro: 'Faça login de novo.' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: ehAdmin } = await admin.from('papeis_usuarios').select('papel').eq('usuario_id', user.id).eq('papel', 'admin').maybeSingle();
    if (!ehAdmin) return json({ erro: 'Só o administrador pode criar acessos.' }, 403);

    const b = await req.json();
    const email = String(b.email ?? '').trim().toLowerCase();
    const senha = String(b.senha ?? '');
    const papel = String(b.papel ?? '');
    const nome = String(b.nome ?? '').trim().slice(0, 40);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: 'E-mail inválido.' }, 400);
    if (!PAPEIS.includes(papel)) return json({ erro: 'Papel inválido.' }, 400);
    if (senha && senha.length < 8) return json({ erro: 'A senha precisa de pelo menos 8 caracteres.' }, 400);

    let id: string | null = null, criado = false;
    if (senha) {
      const r = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true,
        user_metadata: nome ? { nome_exibicao: nome } : {},
      });
      if (r.data?.user) { id = r.data.user.id; criado = true; }
      else if (!/already|registered|exists/i.test(r.error?.message ?? '')) throw r.error;
    }
    if (!id) {                                           // a conta já existia: procura pelo e-mail
      for (let pg = 1; pg <= 20 && !id; pg++) {
        const l = await admin.auth.admin.listUsers({ page: pg, perPage: 200 });
        if (l.error) throw l.error;
        id = l.data.users.find((u) => (u.email ?? '').toLowerCase() === email)?.id ?? null;
        if (l.data.users.length < 200) break;
      }
      if (!id) return json({ erro: 'Não achei essa conta. Informe uma senha para criá-la.' }, 404);
      if (senha) await admin.auth.admin.updateUserById(id, { password: senha, email_confirm: true });
    }
    const { error } = await admin.from('papeis_usuarios').upsert({ usuario_id: id, papel }, { onConflict: 'usuario_id,papel', ignoreDuplicates: true });
    if (error) throw error;
    if (nome) await admin.from('perfis').update({ nome_exibicao: nome }).eq('id', id);
    return json({ ok: true, id, criado });
  } catch (e) {
    return json({ erro: (e as Error).message || 'Falha ao criar o acesso.' }, 500);
  }
});
