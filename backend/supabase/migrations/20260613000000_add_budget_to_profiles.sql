-- Agregar campo de presupuesto mensual a la tabla profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS budget numeric DEFAULT 200000;

-- Política para que los usuarios puedan insertar su propio perfil
-- (necesaria para el trigger on_auth_user_created)
DROP POLICY IF EXISTS "Los usuarios pueden insertar su propio perfil." ON public.profiles;
CREATE POLICY "Los usuarios pueden insertar su propio perfil."
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
