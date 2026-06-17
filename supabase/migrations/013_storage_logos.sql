-- ============================================================
-- STORAGE — bucket público para logos de empresa
-- ============================================================

-- Bucket público (leitura sem autenticação, upload com auth)
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- Qualquer pessoa pode ver os arquivos (logo na tela de login etc.)
CREATE POLICY "logos: público lê"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');

-- Apenas usuários autenticados podem fazer upload/substituir
CREATE POLICY "logos: autenticado envia"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'logos' AND auth.role() = 'authenticated');

CREATE POLICY "logos: autenticado atualiza"
  ON storage.objects FOR UPDATE
  USING  (bucket_id = 'logos' AND auth.role() = 'authenticated')
  WITH CHECK (bucket_id = 'logos' AND auth.role() = 'authenticated');

CREATE POLICY "logos: autenticado deleta"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'logos' AND auth.role() = 'authenticated');
