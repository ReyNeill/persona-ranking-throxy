-- Create storage bucket for CSV uploads
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'csv-uploads',
  'csv-uploads',
  false,
  104857600, -- 100MB limit
  array['text/csv', 'application/vnd.ms-excel', 'text/plain']
)
on conflict (id) do nothing;

-- Policy: service role can do everything
create policy "Service role full access"
on storage.objects for all
using (bucket_id = 'csv-uploads')
with check (bucket_id = 'csv-uploads');
