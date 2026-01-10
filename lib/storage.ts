import { createSupabaseServerClient } from "@/lib/supabase/server"

const BUCKET_NAME = "csv-uploads"

export async function uploadCsvToStorage(
  file: File,
  ingestionId: string
): Promise<string> {
  const supabase = createSupabaseServerClient()
  const path = `ingestions/${ingestionId}/${file.name}`

  const { error } = await supabase.storage.from(BUCKET_NAME).upload(path, file, {
    contentType: "text/csv",
    upsert: false,
  })

  if (error) {
    throw new Error(`Upload failed: ${error.message}`)
  }

  return path
}

export async function downloadCsvFromStorage(path: string): Promise<string> {
  const supabase = createSupabaseServerClient()

  const { data, error } = await supabase.storage.from(BUCKET_NAME).download(path)

  if (error || !data) {
    throw new Error(`Download failed: ${error?.message ?? "No data"}`)
  }

  return data.text()
}

export async function deleteCsvFromStorage(path: string): Promise<void> {
  const supabase = createSupabaseServerClient()

  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path])

  if (error) {
    console.error(`Failed to delete CSV from storage: ${error.message}`)
  }
}
