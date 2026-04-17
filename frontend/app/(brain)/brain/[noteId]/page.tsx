import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Note } from "@/lib/types/database";
import { NoteEditorPage } from "@/components/editor/NoteEditorPage";

interface Props {
  params: Promise<{ noteId: string }>;
}

export default async function NotePage({ params }: Props) {
  const { noteId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("id", noteId)
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    notFound();
  }

  return <NoteEditorPage note={data as Note} />;
}
