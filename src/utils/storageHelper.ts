import crypto from 'crypto';
import { getAdminStorageBucket } from '../config/firebaseAdmin.js';

const MAX_INLINE_DATA_URL_LENGTH = 480_000;

export async function uploadAnnonceImage(
  file: Express.Multer.File | undefined,
  parishId: string,
  annonceId: string
): Promise<{ ok: true; imageUrl?: string } | { ok: false; status: number; error: string }> {
  if (!file) {
    return { ok: true, imageUrl: undefined };
  }

  if (!file.mimetype.startsWith('image/')) {
    return {
      ok: false,
      status: 400,
      error: 'Seuls les fichiers image valides (PNG, JPG, WebP) sont autorisés.',
    };
  }

  const bucket = getAdminStorageBucket();
  if (bucket) {
    try {
      const ext = file.mimetype.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
      const objectPath = `annonces/${parishId}/${annonceId}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const gcsFile = bucket.file(objectPath);
      await gcsFile.save(file.buffer, {
        contentType: file.mimetype,
        resumable: false,
      });
      const [signedUrl] = await gcsFile.getSignedUrl({
        action: 'read',
        expires: '2035-01-01',
      });
      return { ok: true, imageUrl: signedUrl };
    } catch {
      // Fallback safely to size-checked inline Data URL if Cloud Storage bucket is not provisioned
    }
  }

  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  if (dataUrl.length > MAX_INLINE_DATA_URL_LENGTH) {
    return {
      ok: false,
      status: 400,
      error:
        'Image trop volumineuse pour le stockage Firestore direct (max ~350 Ko sans Firebase Storage activé). Réduisez la taille de l’image.',
    };
  }

  return { ok: true, imageUrl: dataUrl };
}
