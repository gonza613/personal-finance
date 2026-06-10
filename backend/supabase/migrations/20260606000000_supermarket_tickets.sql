-- Limpieza de tablas previas si existen
DROP TABLE IF EXISTS public.ticket_items CASCADE;
DROP TABLE IF EXISTS public.tickets CASCADE;
DROP TABLE IF EXISTS public.supermarkets CASCADE;

-- 1. Tabla de supermercados
CREATE TABLE public.supermarkets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabla de tickets
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id UUID REFERENCES public.supermarkets(id) ON DELETE SET NULL,
  purchase_date DATE NOT NULL,
  total_amount NUMERIC(10, 2),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabla de items del ticket
CREATE TABLE public.ticket_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  brand TEXT,
  quantity NUMERIC(10, 3) DEFAULT 1,
  unit TEXT,
  unit_price NUMERIC(10, 2),
  total_price NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_tickets_purchase_date ON public.tickets(purchase_date);
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON public.tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket_id ON public.ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_items_product_name ON public.ticket_items(product_name);

-- Habilitar RLS en todas las tablas
ALTER TABLE public.supermarkets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_items ENABLE ROW LEVEL SECURITY;

-- Políticas para supermarkets
CREATE POLICY "supermarkets_select" ON public.supermarkets FOR SELECT USING (true);
CREATE POLICY "supermarkets_insert" ON public.supermarkets FOR INSERT WITH CHECK (true);

-- Políticas para tickets
CREATE POLICY "tickets_select" ON public.tickets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tickets_insert" ON public.tickets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tickets_update" ON public.tickets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "tickets_delete" ON public.tickets FOR DELETE USING (auth.uid() = user_id);

-- Políticas para ticket_items
CREATE POLICY "items_select" ON public.ticket_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tickets WHERE tickets.id = ticket_items.ticket_id AND tickets.user_id = auth.uid())
);
CREATE POLICY "items_insert" ON public.ticket_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.tickets WHERE tickets.id = ticket_items.ticket_id AND tickets.user_id = auth.uid())
);
CREATE POLICY "items_update" ON public.ticket_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.tickets WHERE tickets.id = ticket_items.ticket_id AND tickets.user_id = auth.uid())
);
CREATE POLICY "items_delete" ON public.ticket_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.tickets WHERE tickets.id = ticket_items.ticket_id AND tickets.user_id = auth.uid())
);
