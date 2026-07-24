'use client';

// Profile photo upload. The file is uploaded directly to the Supabase
// Storage `avatars` bucket from the browser (RLS scopes writes to the
// member's own folder); the resulting public URL is then saved on the
// profile via a server action.
import * as React from 'react';
import { Avatar, Button } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { updateAvatarUrl } from '@/lib/actions';
import { AvatarCropper } from './AvatarCropper';

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

export function AvatarUpload({
  userId,
  name,
  initialUrl,
}: {
  userId: string;
  name: string;
  initialUrl: string | null;
}) {
  const toast = useToast();
  const [url, setUrl] = React.useState<string | null>(initialUrl);
  const [busy, setBusy] = React.useState(false);
  // The image the member just picked, awaiting crop/zoom in the dialog.
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const pick = () => inputRef.current?.click();

  // Picking a file doesn't upload yet — it opens the crop dialog so the member
  // can frame the photo to fit the circular avatar.
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file.', 'warning');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast('Image must be under 3 MB.', 'warning');
      return;
    }
    setPendingFile(file);
  };

  // The cropper hands back a framed square JPEG — upload that.
  const onCropped = async (blob: Blob) => {
    setPendingFile(null);
    setBusy(true);
    const supabase = createClient();
    // Folder is the user id so the RLS policy permits the write. A timestamp
    // in the name busts the CDN cache on replace.
    const path = `${userId}/avatar-${Date.now()}.jpg`;

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (upErr) {
      toast(upErr.message, 'error');
      setBusy(false);
      return;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    await updateAvatarUrl(data.publicUrl);
    setUrl(data.publicUrl);
    toast('Profile photo updated');
    setBusy(false);
  };

  const removePhoto = async () => {
    setBusy(true);
    await updateAvatarUrl(null);
    setUrl(null);
    toast('Profile photo removed');
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-3 mb-4">
      <Avatar name={name} size="xl" src={url} />
      <div className="grid gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          style={{ display: 'none' }}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={pick} disabled={busy}>
            {busy ? 'Uploading…' : url ? 'Change photo' : 'Upload photo'}
          </Button>
          {url ? (
            <Button size="sm" variant="ghost" onClick={removePhoto} disabled={busy}>
              Remove
            </Button>
          ) : null}
        </div>
        <div className="text-xs text-grey">JPG or PNG, up to 3 MB.</div>
      </div>

      {pendingFile ? (
        <AvatarCropper
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onSave={onCropped}
        />
      ) : null}
    </div>
  );
}
