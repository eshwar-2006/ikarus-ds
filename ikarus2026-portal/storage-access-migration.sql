-- Legacy policies labeled "organizer" were granted to public without a role
-- check. Remove those exact bucket policies and add restrictive guards so a
-- future permissive policy cannot expose this private bucket accidentally.
drop policy if exists "Allow organizer upload to competition-materials" on storage.objects;
drop policy if exists "Allow organizer read competition-materials" on storage.objects;
drop policy if exists "Allow organizer update competition-materials" on storage.objects;
drop policy if exists "Allow organizer delete competition-materials" on storage.objects;
drop policy if exists "IKARUS materials authenticated guard" on storage.objects;
create policy "IKARUS materials authenticated guard" on storage.objects
 as restrictive for all to authenticated
 using (bucket_id <> 'competition-materials' or public.ikarus_is_organizer_for((storage.foldername(name))[2]))
 with check (bucket_id <> 'competition-materials' or public.ikarus_is_organizer_for((storage.foldername(name))[2]));
drop policy if exists "IKARUS materials anonymous guard" on storage.objects;
create policy "IKARUS materials anonymous guard" on storage.objects
 as restrictive for all to anon
 using (bucket_id <> 'competition-materials')
 with check (bucket_id <> 'competition-materials');
update storage.buckets set public=false where id='competition-materials';
notify pgrst, 'reload schema';
