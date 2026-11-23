ALTER TABLE public.attendance
ADD COLUMN IF NOT EXISTS jam_masuk_standar text;

DO $$
DECLARE
  legacy_standard text := '07:30';
BEGIN
  IF to_regclass('public.settings') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'settings'
         AND column_name = 'key'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'settings'
         AND column_name = 'jam_masuk_standar'
     ) THEN
    EXECUTE 'SELECT coalesce(jam_masuk_standar, ''07:30'') FROM public.settings LIMIT 1'
      INTO legacy_standard;
    ALTER TABLE public.settings RENAME TO settings_legacy_standardization;

    CREATE TABLE public.settings (
      key text PRIMARY KEY,
      value text NOT NULL
    );

    INSERT INTO public.settings(key, value)
    VALUES ('jamMasukStandar', COALESCE(NULLIF(legacy_standard, ''), '07:30'))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

    DROP TABLE public.settings_legacy_standardization;
  ELSE
    CREATE TABLE IF NOT EXISTS public.settings (
      key text PRIMARY KEY,
      value text NOT NULL
    );
  END IF;

  INSERT INTO public.settings(key, value)
  VALUES ('jamMasukStandar', '07:30')
  ON CONFLICT (key) DO NOTHING;

  UPDATE public.attendance
  SET jam_masuk_standar = COALESCE(
    (SELECT value FROM public.settings WHERE key = 'jamMasukStandar'),
    '07:30'
  )
  WHERE jam_masuk_standar IS NULL;
END $$;