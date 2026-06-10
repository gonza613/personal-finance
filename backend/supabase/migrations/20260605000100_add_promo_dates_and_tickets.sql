-- Migración: Fechas Opcionales en Promociones y Tablas para Tickets / Compras

-- 1. Modificar la tabla promociones para añadir fecha_desde y fecha_hasta (ambas opcionales)
alter table public.promociones 
add column fecha_desde date,
add column fecha_hasta date;

-- 2. Actualizar la función match_promociones para retornar estas nuevas columnas
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
  fecha_desde date,
  fecha_hasta date,
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
    p.fecha_desde,
    p.fecha_hasta,
    1 - (p.embedding <=> query_embedding) as similarity
  from public.promociones p
  where 1 - (p.embedding <=> query_embedding) > match_threshold
  order by p.embedding <=> query_embedding asc
  limit match_count;
end;
$$;

-- 3. Crear la tabla de tickets
create table public.tickets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade default auth.uid() not null,
  comercio text not null,
  fecha date not null,
  total numeric not null,
  creado_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Crear la tabla de detalles de tickets
create table public.ticket_detalles (
  id uuid default gen_random_uuid() primary key,
  ticket_id uuid references public.tickets on delete cascade not null,
  producto text not null,
  precio numeric not null,
  cantidad numeric default 1 not null,
  creado_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Habilitar RLS en las nuevas tablas
alter table public.tickets enable row level security;
alter table public.ticket_detalles enable row level security;

-- 6. Políticas de RLS para tickets
create policy "Los usuarios pueden administrar sus propios tickets."
  on public.tickets for all
  using (auth.uid() = user_id);

-- 7. Políticas de RLS para detalles de tickets
create policy "Los usuarios pueden administrar los detalles de sus propios tickets."
  on public.ticket_detalles for all
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_id and t.user_id = auth.uid()
    )
  );
