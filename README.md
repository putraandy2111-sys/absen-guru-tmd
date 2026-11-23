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

## Android app (Capacitor)

The Android app packages the existing web UI. Its API remains hosted at
`https://absen.tmd.com`, so the phone needs an internet connection to log in and
sync attendance. The backend must be deployed with this repository's current
changes before the app can connect.

1. Install Android Studio and its Android SDK, plus a supported JDK.
2. Install the project dependencies and generate the Android project:

   ```bash
   npm install
   npx cap add android
   ```

3. Deploy the backend changes. By default, the backend allows the Android
   WebView origins `https://localhost` and `capacitor://localhost`; set
   `CORS_ORIGINS` if the web app also needs additional origins.
4. Build and sync the web assets, then open the project in Android Studio:

   ```bash
   npm run cap:sync
   npx cap open android
   ```

The `android` npm script performs the last two commands together.
The mobile build uses `https://absen.tmd.com` as its API origin; override it with
the `CAPACITOR_API_URL` environment variable when building for another backend.
