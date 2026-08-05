# Absen TMD

Aplikasi absensi guru berbasis frontend statis dengan integrasi Supabase.

## Struktur

- `index.html` : halaman utama
- `script.js` : logika frontend dan koneksi Supabase
- `styles.css` : styling UI
- `server.js` : backend lokal untuk development/testing
- `supabase/schema.sql` : skema database siap dipakai di Supabase

## Deploy ke Vercel

1. Push repo ke GitHub.
2. Import repository ke Vercel.
3. Set framework preset menjadi `Other` atau gunakan deployment static.
4. Gunakan `vercel.json` yang sudah tersedia.
5. Pastikan file frontend di root dapat diakses secara publik.

## Setup Supabase

1. Buat project baru di Supabase.
2. Jalankan SQL dari `supabase/schema.sql`.
3. Aktifkan Auth.
4. Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` pada konfigurasi frontend di `script.js`.
5. Pastikan bucket `leave-attachments` sudah dibuat dan public.

## Local run

```bash
npm install
npm start
```
