-- Limpieza de tablas previas si existen
drop table if exists public.expenses cascade;
drop table if exists public.promotions cascade;
drop table if exists public.inversiones_posiciones cascade;
drop table if exists public.gastos cascade;
drop table if exists public.promociones cascade;
drop table if exists public.profiles cascade;

-- Habilitar la extensión pgvector
create extension if not exists vector with schema public;

-- Tabla de Perfiles (extiende Supabase Auth users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  updated_at timestamp with time zone,
  full_name text,
  avatar_url text
);

-- Tabla de Gastos
create table public.gastos (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade default auth.uid() not null,
  monto numeric not null,
  categoria text not null,
  descripcion text,
  fecha timestamp with time zone default timezone('utc'::text, now()) not null,
  embedding vector(768) -- Vector de 768 dimensiones (para gemini-embedding-2 truncado a 768)
);

-- Tabla de Promociones
create table public.promociones (
  id uuid default gen_random_uuid() primary key,
  entidad text not null, -- Banco o Billetera (ej. Galicia, Santander, Lemon, MODO)
  descuento_porcentaje numeric not null,
  tope_reintegro numeric, -- Opcional
  dias_vigencia text not null, -- ej. "Lunes", "Todos los días", "Lunes y Miércoles"
  embedding vector(768)
);

-- Tabla de Posiciones de Inversión
create table public.inversiones_posiciones (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade default auth.uid() not null,
  ticker text not null, -- ej. AL30, GD30D, BTC, ETH, S17A6
  cantidad numeric not null,
  tipo text not null, -- bono, crypto, fci
  plataforma text not null -- ej. BingX, Balanz, Lemon Cash
);

-- Habilitar RLS (Row Level Security) en todas las tablas
alter table public.profiles enable row level security;
alter table public.gastos enable row level security;
alter table public.promociones enable row level security;
alter table public.inversiones_posiciones enable row level security;

-- Políticas para Profiles
create policy "Los usuarios pueden ver su propio perfil."
  on public.profiles for select
  using (auth.uid() = id);

create policy "Los usuarios pueden actualizar su propio perfil."
  on public.profiles for update
  using (auth.uid() = id);

-- Políticas para Gastos
create policy "Los usuarios pueden administrar sus propios gastos."
  on public.gastos for all
  using (auth.uid() = user_id);

-- Políticas para Promociones (Públicas para usuarios autenticados)
create policy "Cualquier usuario autenticado puede ver promociones."
  on public.promociones for select
  using (auth.role() = 'authenticated');

create policy "Cualquier usuario autenticado puede administrar promociones."
  on public.promociones for all
  using (auth.role() = 'authenticated');

-- Políticas para Inversiones
create policy "Los usuarios pueden administrar sus propias inversiones."
  on public.inversiones_posiciones for all
  using (auth.uid() = user_id);

-- Disparador (trigger) para crear automáticamente un perfil de usuario al registrarse
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Función RPC para búsqueda semántica de gastos
create or replace function public.match_gastos (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
returns table (
  id uuid,
  monto numeric,
  categoria text,
  descripcion text,
  fecha timestamp with time zone,
  similarity float
)
language plpgsql stable
as $$
begin
  return query
  select
    g.id,
    g.monto,
    g.categoria,
    g.descripcion,
    g.fecha,
    1 - (g.embedding <=> query_embedding) as similarity
  from public.gastos g
  where g.user_id = p_user_id
    and 1 - (g.embedding <=> query_embedding) > match_threshold
  order by g.embedding <=> query_embedding asc
  limit match_count;
end;
$$;

-- Función RPC para búsqueda semántica de promociones
create or replace function public.match_promociones (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  entidad text,
  descuento_porcentaje numeric,
  tope_reintegro numeric,
  dias_vigencia text,
  similarity float
)
language plpgsql stable
as $$
begin
  return query
  select
    p.id,
    p.entidad,
    p.descuento_porcentaje,
    p.tope_reintegro,
    p.dias_vigencia,
    1 - (p.embedding <=> query_embedding) as similarity
  from public.promociones p
  where 1 - (p.embedding <=> query_embedding) > match_threshold
  order by p.embedding <=> query_embedding asc
  limit match_count;
end;
$$;
