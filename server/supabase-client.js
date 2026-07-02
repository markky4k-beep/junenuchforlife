import './env.js';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export function supabaseEnv() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, publishableKey, serviceRoleKey };
}

export function isSupabaseConfigured({ requireServiceRole = false } = {}) {
  const { url, publishableKey, serviceRoleKey } = supabaseEnv();
  return Boolean(url && (requireServiceRole ? serviceRoleKey : (serviceRoleKey || publishableKey)));
}
export function createSupabasePublicClient() {
  const { url, publishableKey } = supabaseEnv();
  if (!url) throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_URL');
  if (!publishableKey) throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_PUBLISHABLE_KEY ที่ใช้งานได้');
  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export function createSupabaseServiceClient() {
  const { url, serviceRoleKey, publishableKey } = supabaseEnv();
  if (!url) throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_URL');
  if (!serviceRoleKey) throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY ที่ใช้งานได้');
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export function createSupabaseAdminClient() {
  return createSupabaseServiceClient();
}

function storageBucketName() {
  return String(process.env.SITE_ASSET_STORAGE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'site-assets').trim();
}

let _ensuredAssetBucket = null;

export async function ensurePublicAssetBucket() {
  if (_ensuredAssetBucket) return _ensuredAssetBucket;
  _ensuredAssetBucket = (async () => {
    const supabase = createSupabaseAdminClient();
    const bucket = storageBucketName();
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) throw new Error(`โหลด bucket ของ Supabase ไม่สำเร็จ: ${listError.message}`);
    const exists = (buckets || []).some((item) => item?.name === bucket);
    if (!exists) {
      const { error: createError } = await supabase.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: '6MB',
      });
      if (createError && !/already exists/i.test(createError.message || '')) {
        throw new Error(`สร้าง bucket ${bucket} ไม่สำเร็จ: ${createError.message}`);
      }
    }
    return bucket;
  })().catch((error) => {
    _ensuredAssetBucket = null;
    throw error;
  });
  return _ensuredAssetBucket;
}

export async function uploadPublicAsset({ buffer, contentType, extension, folder = 'uploads' }) {
  const supabase = createSupabaseAdminClient();
  const bucket = await ensurePublicAssetBucket();
  const safeExt = String(extension || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const safeFolder = String(folder || 'uploads').replace(/[^a-z0-9/_-]/gi, '').replace(/^\/+|\/+$/g, '') || 'uploads';
  const objectPath = `${safeFolder}/${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${safeExt}`;
  const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadError) throw new Error(`อัปโหลดไฟล์ขึ้น Supabase ไม่สำเร็จ: ${uploadError.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data?.publicUrl || '';
}

export function requireSupabaseServiceRole() {
  const { serviceRoleKey } = supabaseEnv();
  if (!serviceRoleKey) {
    throw new Error('ต้องใช้ SUPABASE_SERVICE_ROLE_KEY สำหรับงานย้ายข้อมูลจริง');
  }
  return serviceRoleKey;
}
