-- 08: foto de perfil do cliente (bucket privado "avatares"; cada um só mexe na própria pasta)
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('avatares', 'avatares', false, 2097152)
    on conflict (id) do nothing;
    drop policy if exists avatares_enviar on storage.objects;
    create policy avatares_enviar on storage.objects for insert to authenticated
      with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
    drop policy if exists avatares_trocar on storage.objects;
    create policy avatares_trocar on storage.objects for update to authenticated
      using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
    drop policy if exists avatares_ver on storage.objects;
    create policy avatares_ver on storage.objects for select to authenticated
      using (bucket_id = 'avatares' and ((storage.foldername(name))[1] = auth.uid()::text or public.eh_funcionario()));
    drop policy if exists avatares_apagar on storage.objects;
    create policy avatares_apagar on storage.objects for delete to authenticated
      using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
